/**
 * #40: widget Android. Si aggiornano:
 * - quando cambi la lista o la spesa nell'app (refreshWidgets, chiamata dallo store);
 * - quando un familiare cambia la lista di casa o la spesa: il server manda un avviso invisibile (solo dati, type=widget)
 *   e il telefono ridisegna il widget anche ad app chiusa (compito in background di expo-notifications);
 * - ogni 30 minuti come riserva (updatePeriodMillis in app.json).
 * Questo codice arriva solo agli APK dalla 1.4.0 in su (runtimeVersion 3), che hanno sempre i moduli nativi:
 * niente controllo «c'è il modulo?» (TurboModuleRegistry.get restituiva null anche quando il modulo c'era,
 * perché la libreria si registra come modulo nativo classico: il widget restava vuoto).
 */
const NAMES = ['ListaGrande', 'ListaPiccolo'];
export const WIDGET_TASK = 'mc-widget-push';

let timer: ReturnType<typeof setTimeout> | null = null;

async function redraw() {
  const { requestWidgetUpdate } = require('react-native-android-widget') as typeof import('react-native-android-widget');
  const { loadWidgetData } = require('./data') as typeof import('./data');
  const { renderFor } = require('./widgets') as typeof import('./widgets');
  const data = await loadWidgetData();
  for (const name of NAMES) {
    await requestWidgetUpdate({ widgetName: name, renderWidget: (info) => renderFor(name, data, info.height) }).catch(() => {});
  }
}

/** ridisegna i widget (con un attimo di attesa: più cambi di fila = un solo aggiornamento) */
export function refreshWidgets(delayMs = 1200): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; redraw().catch(() => {}); }, delayMs);
}

export function registerWidgets(): void {
  const { registerWidgetTaskHandler } = require('react-native-android-widget') as typeof import('react-native-android-widget');
  registerWidgetTaskHandler(async ({ widgetInfo, widgetAction, renderWidget }) => {
    if (widgetAction === 'WIDGET_DELETED') return;
    const { cachedWidgetData, loadWidgetData } = require('./data') as typeof import('./data');
    const { renderFor } = require('./widgets') as typeof import('./widgets');
    // prima quello che so (subito), poi quello fresco dal server
    const empty = { family: false, total: 0, items: [], shop: null, at: new Date().toISOString() };
    const cached = await cachedWidgetData().catch(() => null);
    renderWidget(renderFor(widgetInfo.widgetName, cached ?? empty, widgetInfo.height));
    try {
      const fresh = await loadWidgetData();
      renderWidget(renderFor(widgetInfo.widgetName, fresh, widgetInfo.height));
    } catch { /* senza rete resta quello disegnato sopra */ }
  });

  // avviso invisibile dal server («la lista di casa è cambiata»): ridisegno anche ad app chiusa
  const TaskManager = require('expo-task-manager') as typeof import('expo-task-manager');
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');
  if (!TaskManager.isTaskDefined(WIDGET_TASK)) {
    TaskManager.defineTask(WIDGET_TASK, async () => { await redraw().catch(() => {}); });
  }
  Notifications.registerTaskAsync(WIDGET_TASK).catch(() => {});
  // all'avvio dell'app il widget si ridisegna subito con i dati di adesso
  refreshWidgets(500);
}
