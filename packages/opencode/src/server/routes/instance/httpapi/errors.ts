import { Schema } from "effect"

export class ApiNotFoundError extends Schema.ErrorClass<ApiNotFoundError>("NotFoundError")(
  {
    name: Schema.Literal("NotFoundError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 404 },
) {}

export function notFound(message: string) {
  return new ApiNotFoundError({
    name: "NotFoundError",
    data: { message },
  })
}

// Handler-raised `HttpApiError.BadRequest` serializes as `{"_tag": "BadRequest"}`
// on the wire, which does not match the public spec's `{name, data}` BadRequestError
// shape (that shape is only produced by schema-validation failures via the
// schema-error middleware). Declare this class so handlers can fail with a 400
// whose body matches the declared contract.
export class ApiBadRequestError extends Schema.ErrorClass<ApiBadRequestError>("BadRequest")(
  {
    name: Schema.Literal("BadRequest"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export function badRequest(message: string) {
  return new ApiBadRequestError({
    name: "BadRequest",
    data: { message },
  })
}
