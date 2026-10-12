export async function readBounded(source: Request | Response, limit: number): Promise<Uint8Array | null> {
  if (Number(source.headers.get('Content-Length') ?? 0) > limit) return null;
  let size = 0;
  const capped = source.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > limit) controller.error(new RangeError('body too large'));
        else controller.enqueue(chunk);
      },
    }),
  );
  try {
    return capped ? new Uint8Array(await new Response(capped).arrayBuffer()) : new Uint8Array();
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export async function readJson(request: Request, limit: number): Promise<{ body: unknown } | null> {
  const bytes = await readBounded(request, limit);
  if (!bytes) return null;
  const text = new TextDecoder().decode(bytes);
  try {
    return { body: text === '' ? null : JSON.parse(text) };
  } catch {
    return null;
  }
}
