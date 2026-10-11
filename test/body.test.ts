import { expect, test } from 'bun:test';
import { readJson } from '../src/worker/body';

const LIMIT = 16;

function streamed(...chunks: string[]): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return new Request('https://nudge.example/api/setup', { method: 'POST', body, duplex: 'half' });
}

test.each([
  ['a small JSON body', streamed('{"a":', '1}'), { body: { a: 1 } }],
  ['an empty body', new Request('https://nudge.example/api/x', { method: 'POST' }), { body: null }],
  ['an oversized body with no Content-Length', streamed('{"a":"', 'x'.repeat(40), '"}'), null],
  ['multi-byte text over the byte limit', streamed(`"${'é'.repeat(9)}"`), null],
  [
    'a declared Content-Length over the limit',
    new Request('https://nudge.example/api/x', { method: 'POST', body: '{}', headers: { 'Content-Length': '999' } }),
    null,
  ],
  ['malformed JSON', streamed('{oops'), null],
])('readJson: %s', async (_, request, expected) => {
  expect(await readJson(request, LIMIT)).toEqual(expected);
});
