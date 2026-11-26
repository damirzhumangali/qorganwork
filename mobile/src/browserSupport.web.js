import { Alert, Share } from 'react-native';
import './web.css';

document.documentElement.lang = 'ru';
document.title = 'qwork — команда, задачи, результат';
const viewport = document.querySelector('meta[name="viewport"]');
if (viewport) viewport.content = 'width=device-width,initial-scale=1,viewport-fit=cover';
for (const [rel, href] of [['icon', '/icon.svg'], ['manifest', '/manifest.webmanifest']]) {
  const link = document.createElement('link'); link.rel = rel; link.href = href; document.head.append(link);
}

Alert.alert = (title, message, buttons = [{ text: 'OK' }], options = {}) => {
  const previous = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'qwork-dialog';
  const heading = document.createElement('h2'); heading.textContent = title;
  heading.id = `alert-${crypto.randomUUID()}`; dialog.setAttribute('aria-labelledby', heading.id);
  const copy = document.createElement('p'); copy.textContent = message || '';
  const actions = document.createElement('div'); actions.className = 'qwork-dialog-actions';
  function close() { dialog.close(); dialog.remove(); previous?.focus?.(); }
  for (const action of buttons.length ? buttons : [{ text: 'OK' }]) {
    const button = document.createElement('button'); button.textContent = action.text || 'OK';
    button.className = action.style === 'destructive' ? 'danger' : action.style === 'cancel' ? 'cancel' : '';
    button.onclick = () => { close(); action.onPress?.(); };
    actions.append(button);
  }
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    const cancel = buttons.find(action => action.style === 'cancel');
    if (cancel || options.cancelable) { close(); cancel?.onPress?.(); options.onDismiss?.(); }
  });
  dialog.append(heading, copy, actions); document.body.append(dialog); dialog.showModal();
};

Share.share = async ({ title, message, url }) => {
  if (navigator.share) {
    try { await navigator.share({ title, text: message, url }); return { action: Share.sharedAction }; }
    catch (error) { if (error.name === 'AbortError') return { action: Share.dismissedAction }; throw error; }
  }
  if (!navigator.clipboard?.writeText) throw new Error('Копирование недоступно в этом браузере.');
  await navigator.clipboard.writeText([message, url].filter(Boolean).join('\n'));
  Alert.alert('Скопировано', 'Текст скопирован. Вставьте его в сообщение получателю.');
  return { action: Share.sharedAction };
};
