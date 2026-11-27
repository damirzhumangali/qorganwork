import * as Location from 'expo-location';
export async function getVisitPosition() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Разрешите геолокацию для автоотметок в настройках телефона.');
  let timer;
  try {
    const position = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Не удалось получить GPS. Попробуйте снова.')), 15000); })]);
    return { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy,
      mocked: Boolean(position.mocked), capturedAt: new Date(position.timestamp).toISOString() };
  } finally { clearTimeout(timer); }
}
