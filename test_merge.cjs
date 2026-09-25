const { mergeDeep } = require("remeda")

const target = { options: { fetch: "test" } }
const source = { options: {} }
console.log(mergeDeep(target, source))

const source2 = { options: { fetch: "test2" } }
console.log(mergeDeep(target, source2))
