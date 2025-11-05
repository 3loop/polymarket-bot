import { decoder, getPublicClient } from "./decoder/decoder.js";
import { interpretTransaction } from "./decoder/interpreter.js";
import {
  CHAIN_ID,
  ETHERSCAN_ENDPOINT,
  POLYMARKET_EXCHANGE_ADDRESS,
  ORDER_FILLED_EVENT_ABI,
} from "./constants.js";
import { createPublicClient, webSocket, type Hex } from "viem";
import { Configuration, NeynarAPIClient } from "@neynar/nodejs-sdk";
import { FetchBulkUsersByEthOrSolAddressAddressTypesEnum } from "@neynar/nodejs-sdk/build/api/api.js";

const NEYNAR_API_KEY = process.env["NEYNAR_API_KEY"] || "";
const SIGNER_UUID = process.env["NEYNAR_SIGNER_UUID"] || "";
const farcasterClient = new NeynarAPIClient(
  new Configuration({ apiKey: NEYNAR_API_KEY })
);

const wsClient = createPublicClient({
  transport: webSocket(process.env.WS_RPC_URL || ""),
});

async function publishToFarcaster({
  action,
  farcasterUsername,
  hash,
}: {
  action: string;
  farcasterUsername?: string;
  hash: string;
}) {
  try {
    const message = {
      text: farcasterUsername ? `@${farcasterUsername} ${action}` : action,
      url: `${ETHERSCAN_ENDPOINT}/tx/${hash}`,
    };

    const publishCastResponse = await farcasterClient.publishCast({
      signerUuid: SIGNER_UUID,
      text: message.text,
      embeds: [
        {
          url: message.url,
        },
      ],
    });
    console.log(
      `[Farcaster] ✓ Published: "${
        message.text
      }" → ${publishCastResponse.cast.hash.substring(0, 10)}...`
    );
  } catch (error) {
    console.error(
      `[Farcaster] ✗ Failed to publish ${hash.substring(0, 10)}...:`,
      error
    );
  }
}

async function resolveFarcasterUser(userAddress: `0x${string}`) {
  try {
    const response = await farcasterClient.fetchBulkUsersByEthOrSolAddress({
      addresses: [userAddress],
      addressTypes: [
        FetchBulkUsersByEthOrSolAddressAddressTypesEnum.VerifiedAddress,
      ],
    });

    if (response && response[userAddress.toLowerCase()]) {
      const user = response[userAddress.toLowerCase()][0];
      console.log(`[Farcaster] ✓ @${user.username} (fid: ${user.fid})`);
      return {
        username: user.username,
        fid: user.fid,
      };
    }

    return null;
  } catch (error) {
    console.error(
      `[Farcaster] ✗ Error resolving ${userAddress.substring(0, 10)}...:`,
      error
    );
    return null;
  }
}

async function handleTransaction(txHash: string, userAddress: `0x${string}`) {
  try {
    const shortTxHash = `${txHash.substring(0, 10)}`;
    console.log(
      `[Transaction Handler] Processing transaction: ${shortTxHash}, user: ${userAddress}...`
    );
    console.log(
      `[Transaction Handler] Waiting for transaction confirmation ${shortTxHash}...`
    );

    // to make sure the transaction is mined before decoding it
    const { client: publicClient } = getPublicClient(CHAIN_ID);
    await publicClient.waitForTransactionReceipt({
      hash: txHash as Hex,
      // TODO: this delayes decoding, but number > than 1 is required for PL transacitons
      // Depending on RPC provider, you may need to adjust this number
      confirmations: 4,
    });

    console.log(`[Transaction Handler] ✓ Transaction confirmed ${shortTxHash}`);
    
    const decoded = await decoder.decodeTransaction({
      chainID: CHAIN_ID,
      hash: txHash,
    });

    if (!decoded) {
      console.log(`[Decoder] ✗ Failed to decode ${shortTxHash}...`);
      return;
    }
    console.log(`[Decoder] ✓ Decoded successfully ${shortTxHash}`);

    console.log(`[Interpreter] Interpreting transaction...`);
    const interpreted = await interpretTransaction(decoded, userAddress);

    if (
      !interpreted ||
      (interpreted.type !== "sell-outcome" &&
        interpreted.type !== "buy-outcome")
    ) {
      console.log(
        `[Interpreter] Skipped (type: ${interpreted?.type || "unknown"})`
      );
      return;
    }
    console.log(
      `[Interpreter] ✓ Interpreted as ${interpreted.type} ${shortTxHash}`
    );

    const polymarketWallet = interpreted.user.address;
    const proxyWallets =
      interpreted.context && "proxyWallets" in interpreted.context
        ? interpreted.context.proxyWallets
        : undefined;
    const owner = Array.isArray(proxyWallets)
      ? proxyWallets.find(
          (w: any) => w.proxy.toLowerCase() === polymarketWallet.toLowerCase()
        )?.signer
      : undefined;

    // TODO: Uncomment this to resolve Farcaster user by owner address
    // const farcasterUser = await resolveFarcasterUser(owner);
    const farcasterUser = {} as { username?: string; fid?: number };

    const message = {
      action: interpreted.action,
      mainWallet: owner,
      polymarketWallet,
      txHash,
      farcasterUsername: farcasterUser?.username,
    };

    console.log(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    );
    console.log(`  🎯 ACTION: ${message.action}`);
    console.log(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    );
    console.log(`  Main Wallet: ${message.mainWallet}`);
    console.log(`  Polymarket Wallet: ${message.polymarketWallet}`);
    console.log(`  Transaction Hash: ${message.txHash}`);
    console.log(`  Farcaster Username: ${message.farcasterUsername || "N/A"}`);
    // TODO: Uncomment this to publish messages to Farcaster
    // await publishToFarcaster(message);
  } catch (e) {
    console.error(
      `[Transaction] ✗ Error processing ${txHash.substring(0, 10)}...:`,
      e
    );
  }
}
let lastProcessedAt = Date.now();

// TODO: this subscription filters by maker address, while users can be also takers
// To subsribe for events when user is a taker as well, you would need to create one more subscription
async function createSubscription(addressesToTrack: `0x${string}`[]) {
  console.log(
    `[Subscription] Creating WebSocket subscription (Polygon RPC) | Exchange: ${POLYMARKET_EXCHANGE_ADDRESS}`
  );
  console.log(
    `[Subscription] Tracking ${
      addressesToTrack.length
    } address(es): ${addressesToTrack
      .map((a) => a.substring(0, 8))
      .join(", ")}...`
  );

  try {
    const unsubscribe = wsClient.watchEvent({
      address: POLYMARKET_EXCHANGE_ADDRESS,
      event: ORDER_FILLED_EVENT_ABI,
      args: {
        maker: addressesToTrack, // For the demo, monitor only where user is a maker
      },
      onLogs: (logs: any) => {
        console.log(
          `[Subscription] 📥 Received new OrderFilled event(s): ${logs.length}`
        );
        logs.forEach((log: any) => {
          lastProcessedAt = Date.now();
          handleTransaction(
            log.transactionHash,
            log.args.maker as `0x${string}`
          );
        });
      },
    });

    console.log(`[Subscription] ✓ Active, monitoring OrderFilled events...`);

    const interval = setInterval(() => {
      const timeSinceLastProcessed = Date.now() - lastProcessedAt;
      if (timeSinceLastProcessed > 60_000 * 10) {
        console.error(
          `[Subscription] ⚠️  No activity for 10min, restarting...`
        );
        clearInterval(interval);
        unsubscribe();
        createSubscription(addressesToTrack);
      }
    }, 60_000 * 10);
  } catch (error) {
    console.error(`[Subscription] ✗ Failed:`, error);
  }
}

const ADDRESSES_TO_TRACK = [
  "0xca85f4b9e472b542e1df039594eeaebb6d466bf2", //some random high transacting address
];

console.log(`[Bot] Starting Polymarket bot...`);
console.log(
  `[Bot] 🚀 Starting | Chain: ${CHAIN_ID} (Polygon) | Exchange: ${POLYMARKET_EXCHANGE_ADDRESS}`
);
createSubscription(ADDRESSES_TO_TRACK as `0x${string}`[]);
