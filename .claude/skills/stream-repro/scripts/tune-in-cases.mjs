export function tuneInCase(index) {
  const periodic = (period) => index % period === Math.floor(index / period) % 2;
  return {
    channelIndex: index % 2,
    cold: index < 2 || periodic(20),
    secondViewer: periodic(10),
  };
}
