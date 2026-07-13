# Console Function Package

## openauth Type Bug

- `@openauthjs/openauth` 0.4.3 has a type bug: the conditional type in `OnSuccessResponder.subject()`'s `properties` parameter causes TypeScript to skip the `id: string` parameter. Runtime expects `subject(type, id, properties, opts?)`. Use `@ts-expect-error` with an explanatory comment.
