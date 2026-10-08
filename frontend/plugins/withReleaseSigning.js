/**
 * Firma dell'APK con la chiave definitiva di Mi Conviene (quella che servirà anche per il Play Store).
 * La chiave NON sta nel progetto: il file e le password arrivano dalle variabili d'ambiente della build
 * (MC_KEYSTORE, MC_KEYSTORE_PASSWORD, MC_KEY_ALIAS, MC_KEY_PASSWORD). Senza, resta la firma di prova.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes('MC_KEYSTORE')) return cfg;
    g = g.replace(/signingConfigs\s*\{/, `signingConfigs {
        release {
            if (System.getenv('MC_KEYSTORE')) {
                storeFile file(System.getenv('MC_KEYSTORE'))
                storePassword System.getenv('MC_KEYSTORE_PASSWORD')
                keyAlias System.getenv('MC_KEY_ALIAS')
                keyPassword System.getenv('MC_KEY_PASSWORD')
            }
        }`);
    // nel blocco release dei buildTypes: firma definitiva se la chiave c'è
    g = g.replace(/(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig System.getenv('MC_KEYSTORE') ? signingConfigs.release : signingConfigs.debug`);
    cfg.modResults.contents = g;
    return cfg;
  });
};
