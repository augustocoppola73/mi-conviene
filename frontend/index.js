// Ingresso dell'app: prima i widget Android (#40, devono esistere anche quando l'app è chiusa), poi expo-router.
import { registerWidgets } from './src/widget';

registerWidgets();

import 'expo-router/entry';
