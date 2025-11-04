//Polygon Mainnet
export const CHAIN_ID = 137;

//Etherscan endpoint to create a transaction link
export const ETHERSCAN_ENDPOINT = "https://polygonscan.com";

export const RPC = {
  137: {
    url: process.env.RPC_URL || "",
    
    // Transaciton decoder by default needs archive node for transaction tracing
    // Provide "none" when transaciton tracing is not needed
    traceAPI: "none" as "parity" | "geth" | "none",
  },
};

// Contract addresses to monitor for new PL events
export const POLYMARKET_EXCHANGE_ADDRESS = "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e";

export const ORDER_FILLED_EVENT_ABI = {
  inputs: [
    {
      indexed: true,
      internalType: "bytes32",
      name: "orderHash",
      type: "bytes32",
    },
    {
      indexed: true,
      internalType: "address",
      name: "maker",
      type: "address",
    },
    {
      indexed: true,
      internalType: "address",
      name: "taker",
      type: "address",
    },
    {
      indexed: false,
      internalType: "uint256",
      name: "makerAssetId",
      type: "uint256",
    },
    {
      indexed: false,
      internalType: "uint256",
      name: "takerAssetId",
      type: "uint256",
    },
    {
      indexed: false,
      internalType: "uint256",
      name: "makerAmountFilled",
      type: "uint256",
    },
    {
      indexed: false,
      internalType: "uint256",
      name: "takerAmountFilled",
      type: "uint256",
    },
    {
      indexed: false,
      internalType: "uint256",
      name: "fee",
      type: "uint256",
    },
  ],
  name: "OrderFilled",
  type: "event",
} as const;