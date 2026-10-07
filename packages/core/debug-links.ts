import { tokenizeInline, flattenTokens } from './src/inline.ts'
import { parseLinks } from './src/links.ts'
const source = '[[]] 和 [[   ]] 和 [[a[b]]'
const tokens = tokenizeInline(source)
console.log('tokens:', JSON.stringify(tokens))
console.log('flat links:', JSON.stringify(flattenTokens(tokens).filter((t) => t.type === 'link')))
console.log('parseLinks:', JSON.stringify(parseLinks(source)))
