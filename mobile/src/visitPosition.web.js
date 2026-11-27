export function getVisitPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Геолокация недоступна в этом браузере.')); return; }
    navigator.geolocation.getCurrentPosition(position => resolve({
      latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy,
      capturedAt: new Date(position.timestamp).toISOString(),
    }), error => reject(new Error(error.code === 1 ? 'Разрешите геолокацию для автоотметок в настройках сайта.'
      : 'Не удалось получить GPS. Проверьте геолокацию и включите автоотметку снова.')),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  });
}
