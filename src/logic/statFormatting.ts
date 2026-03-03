export const formatBattingAverage = (value: number): string => {
  const fixed = value.toFixed(3);
  return fixed.startsWith('0.') ? fixed.slice(1) : fixed;
};
