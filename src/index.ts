import { decoder, getPublicClient } from "./decoder/decoder.js";
import {
  interpretTransaction,
} from "./decoder/interpreter.js";
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
    console.log(`new cast created: ${publishCastResponse.cast.hash}`);
  } catch (error) {
    console.error(error);
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
      return {
        username: user.username,
        fid: user.fid,
      };
    }

    return null;
  } catch (error) {
    console.error("Error resolving Farcaster user", userAddress);
    return null;
  }
}

async function handleTransaction(txHash: string, userAddress: `0x${string}`) {
  try {
    // to make sure the transaction is mined before decoding it
    const { client: publicClient } = getPublicClient(CHAIN_ID);
    await publicClient.waitForTransactionReceipt({
      hash: txHash as Hex,
      // TODO: this delayes decoding, but number > than 1 is required for PL transacitons
      // Depending on RPC provider, you may need to adjust this number
      confirmations: 4,
    });

    const decoded = await decoder.decodeTransaction({
      chainID: CHAIN_ID,
      hash: txHash,
    });

    if (!decoded) return;

    const interpreted = await interpretTransaction(decoded, userAddress);

    if (
      !interpreted ||
      (interpreted.type !== "sell-outcome" &&
        interpreted.type !== "buy-outcome")
    ) {
      console.log("Transaction is not a sell or buy outcome", txHash);
      return;
    }

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

    console.log("Interpreted transaction:", message);

    // TODO: Uncomment this to publish messages to Farcaster
    // await publishToFarcaster(message);
  } catch (e) {
    console.error(e);
  }
}
let lastProcessedAt = Date.now();

// TODO: this subscription filters by maker address, while users can be also takers
// To subsribe for events when user is a taker as well, you would need to create one more subscription
async function createSubscription(addressesToTrack: `0x${string}`[]) {
  console.log("Creating subscription...");

  try {
    const unsubscribe = wsClient.watchEvent({
      address: POLYMARKET_EXCHANGE_ADDRESS,
      event: ORDER_FILLED_EVENT_ABI,
      args: {
        maker: addressesToTrack, // For the demo, monitor only where user is a maker
      },
      onLogs: (logs: any) => {
        logs.forEach((log: any) => {
          console.log("New transaction detected:", log.transactionHash);
          handleTransaction(
            log.transactionHash,
            log.args.maker as `0x${string}`
          );
        });
      },
    });

    const interval = setInterval(() => {
      if (Date.now() - lastProcessedAt > 60_000 * 10) {
        console.error(
          "No new transactions in the last 10 minutes, restarting subscription"
        );
        clearInterval(interval);
        unsubscribe();
        createSubscription(addressesToTrack);
      }
    }, 60_000 * 10);
  } catch (error) {
    console.error(error);
  }
}

const ADDRESSES_TO_TRACK = [
  "0xca85f4b9e472b542e1df039594eeaebb6d466bf2", //some random high transacting address
];

createSubscription(ADDRESSES_TO_TRACK as `0x${string}`[]);
