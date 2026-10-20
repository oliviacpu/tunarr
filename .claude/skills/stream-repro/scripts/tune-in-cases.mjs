export function tuneInCase(index) {
  const periodic = (period) => index % period === Math.floor(index / period) % 2;
  return {
    channelIndex: index % 2,
    cold: index < 2 || periodic(20),
    secondViewer: periodic(10),
  };
}

export async function resetSession(url, request = fetch) {
  const response = await request(url, { method: 'DELETE' });
  await response.body?.cancel();
  if (!response.ok && response.status !== 404) {
    throw new Error(`Cold reset failed: HTTP ${response.status}`);
  }
}
