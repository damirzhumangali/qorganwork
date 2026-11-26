// Device PIN/biometrics use the native keychain; browser sessions stay in memory.
export const quickAccessSupported = false;
export async function readQuickAccess() { return null; }
export async function clearQuickAccess() {}
export default function QuickAccess() { return null; }
