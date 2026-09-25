const { mergeDeep } = require("remeda")

const target = { options: { fetch: "test" } }
const source = { options: {} }
console.log(mergeDeep(target, source))
