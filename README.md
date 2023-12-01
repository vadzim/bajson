# bajson

Supports stringifying for promises, async generators and Node.js object streams.

Big-friendly asynchronous JSON stringifying.

- [Why would I want this?](#why-would-i-want-this)
- [Is it fast?](#is-it-fast)
- [What functions does it implement?](#what-functions-does-it-implement)
- [What kind of async values does it support?](#what-kind-of-async-values-does-it-support)
- [Is it compatible with `JSON.stringify`?](#is-it-compatible-with-jsonstringify)
- [How do I write a JSON file?](#how-do-i-write-bajson-file)
- [How do I response with JSON by http?](#how-do-i-response-with-json-by-http)
- [Can I lazily stringify data from MongoDB?](#can-i-lazily-stringify-data-from-mongodb)
- [How do I create a JSON string?](#how-do-i-create-bajson-string)
- [Why does `stringify` emit binary chunks instead of strings?](#why-does-stringify-emit-binary-chunks-instead-of-strings)
  <!-- * [Can it handle newline-delimited JSON (NDJSON)?](#can-it-handle-newline-delimited-json-ndjson) -->
  <!-- * [What versions of Node.js does it support?](#what-versions-of-nodejs-does-it-support) -->

## Why would I want this?

The main feature is that `stringify` resolves promises and stringify async iterables, including streams, into arrays on the fly. There's no need to collect their data in an array beforehand, and neither it does that.

`bajson` also does not monopolize the event loop and emits limited chunks so it doesn't lead to out-of-memory exceptions on large datasets.

It's considerably faster comparing to other non-blocking package `bfj`, although `bfj` seems to be more efficient in memory usage. Pick the one that best suits your needs.

## Is it fast?

Kind of.

`stringify` is about 10 times faster than `bfj` package while still avoiding monopolizing the event loop, though it's still 3-4 times slower than the native implementation of `JSON.stringify`.

## What functions does it implement?

It currently implements stringification, with parsing planned for the future.

```js
import { pipeline } from "node:stream/promises"
import { stringify } from "bajson"

await pipeline(stringify(data), stream)
```

## What kind of async values does it support?

It supports promises and async and sync iterables.

```js
async function createData() {
	yield "text"
	yield 777
}

stringify(createData())
//-> ["text",777]

stringify({ a: Promise.resolve(42), b: createData() })
//-> {"a":42,"b":["text",777]}
```

## Is it compatible with JSON.stringify?

Yes, it accepts the same arguments and returns the same results in all practical scenarios.

However, there is one difference: `stringify` emits `'null'` in cases where `JSON.stringify` would return `undefined`. This distinction is due to the fact that `stringify` cannot return `undefined` since it always returns a stream.

```js
JSON.stringify(() => {})
// undefined
JSON.stringify({ a: () => {} })
// "{}"
JSON.stringify([() => {}])
// "[null]"
stringify(() => {})
// "null"
stringify({ a: () => {} })
// "{}"
stringify([() => {}])
// "[null]"
```

## How do I write a JSON file?

```js
import { createWriteStream } from "node:fs"
import { pipeline } from "node:stream/promises"
import { stringify } from "bajson"

await pipeline(stringify(data), createWriteStream(path))
```

## How do I response with JSON by http?

```js
import express from "express"
import { pipeline } from "node:stream/promises"
import { stringify } from "bajson"

const app = express()

app.get("/get-json", async (request, response) => {
	response.setHeader("Content-Type", "application/json")
	await pipeline(stringify(data), response)
})
```

## Can I lazily stringify data from MongoDB?

Sure.

```js
import express from "express"
import { pipeline } from "node:stream/promises"
import { stringify } from "bajson"
import { Book } from "@/models/book.model"
import { Author } from "@/models/author.model"
import { Publisher } from "@/models/publisher.model"

const app = express()

app.get("/give-me-it-all", async (request, response) => {
	response.setHeader("Content-Type", "application/json")
	await pipeline(
		stringify({
			books: Book.find().cursor(),
			authors: Author.find().cursor(),
			publishers: Publisher.find().cursor(),
		}),
		response,
	)
	// {
	//   "books": [{ "name": "book1", ... }, { "name": "book2", ... }, ...],
	//   "authors": [{ "name": "author1", ... }, { "name": "author2", ... }, ...],
	//   "publishers": [{ "name": "publisher1", ... }, { "name": "publisher2", ... }, ...]
	// }
})
```

## How do I create a JSON string?

I'm not sure you really want that, but

```js
import { stringify } from "bajson"
import fromAsync from "array-from-async"

await new Blob(await fromAsync(stringify(data))).text()
```

## Why does `stringify` emit binary chunks instead of strings?

For practical reasons.

There are scenarios where people need to store stringified JSON within a string field. For example:

```js
const data = {
	number: 42,
	anotherData: JSON.stringify({ anotherNumber: 24 }),
}
JSON.stringify(data)
```

With this module, it transforms into:

```js
const data = {
	number: 42,
	anotherData: stringify({ anotherNumber: 24 }),
}
stringify(data)
```

If `stringify` emitted strings, it would be impossible to distinguish between such stringified data and an asynchronous array of strings, which is more commonly used than stringifying an asynchronous array of binaries to JSON.

If the first value of a stream is binary (including zero length), then `stringify` treats the entire stream as a binary representation of a string; otherwise, it's treated as an array.
