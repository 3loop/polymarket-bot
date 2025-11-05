import type { DecodedTransaction } from "@3loop/transaction-decoder";
import {
  QuickjsInterpreterLive,
  QuickjsConfig,
  TransactionInterpreter,
  getInterpreter,
  fallbackInterpreter,
} from "@3loop/transaction-interpreter";
import { Effect, Layer } from "effect";
import variant from "@jitl/quickjs-singlefile-cjs-release-sync";

const config = Layer.succeed(QuickjsConfig, {
  variant: variant,
  runtimeConfig: {
    timeout: 5000,
    //This is required for Polymarket transactions, since the markets data in taken offchain
    useFetch: true,
  },
});

const layer = Layer.provide(QuickjsInterpreterLive, config);

export async function interpretTransaction(
  decodedTx: DecodedTransaction,
  userAddress: `0x${string}`
) {
  let interpreter = getInterpreter(decodedTx) ?? fallbackInterpreter;

  const runnable = Effect.gen(function* () {
    const interpreterService = yield* TransactionInterpreter;
    const interpretation = yield* interpreterService.interpretTransaction(
      decodedTx,
      {
        id: "default",
        schema: interpreter,
      },
      {
        interpretAsUserAddress: userAddress,
      }
    );
    return interpretation;
  }).pipe(Effect.provide(layer));

  return Effect.runPromise(runnable).catch((e) => {
    console.error(`[Interpreter] ✗ Error:`, e);
    return null;
  });
}
