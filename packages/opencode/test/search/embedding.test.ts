import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { EmbeddingService, type EmbeddingServiceInterface, WordPieceTokenizer } from "../../src/search/embedding"

describe("EmbeddingService DI", () => {
  test("resolves from layer and satisfies interface contract", async () => {
    const mockService: EmbeddingServiceInterface = {
      embed: (texts) => Effect.succeed(texts.map(() => [0.1, 0.2, 0.3])),
      dimension: 3,
    }
    const layer = Layer.succeed(EmbeddingService, mockService)

    const resolved = await Effect.gen(function* () {
      return yield* EmbeddingService
    }).pipe(
      Effect.provide(layer),
      Effect.runPromise,
    )

    expect(resolved).toBeDefined()
    expect(resolved.embed).toBeDefined()
    expect(resolved.dimension).toBe(3)
  })
})

describe("WordPieceTokenizer", () => {
  const vocab = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "hello", "world", "##s"]
  const tokenizer = new WordPieceTokenizer(vocab)

  test("encodes known words with CLS and SEP tokens", () => {
    const result = tokenizer.encode("hello world")
    // [CLS] = 2, hello = 4, world = 5, [SEP] = 3
    expect(result.input_ids).toEqual([2, 4, 5, 3])
    expect(result.attention_mask).toEqual([1, 1, 1, 1])
  })

  test("strips accents and converts to lowercase", () => {
    const result = tokenizer.encode("Héllò")
    // Héllò normalization -> NFKD -> hello
    expect(result.input_ids).toEqual([2, 4, 3])
  })

  test("handles subwords using ## prefix", () => {
    const result = tokenizer.encode("hellos")
    // hellos splits to hello + ##s
    expect(result.input_ids).toEqual([2, 4, 6, 3])
  })

  test("handles unknown words with UNK token", () => {
    const result = tokenizer.encode("unknownword")
    // [UNK] = 1
    expect(result.input_ids).toEqual([2, 1, 3])
  })
})
