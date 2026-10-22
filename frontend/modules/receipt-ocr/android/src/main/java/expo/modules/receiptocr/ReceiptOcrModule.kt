package expo.modules.receiptocr

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * #32: legge il testo di una foto (lo scontrino) con ML Kit, tutto nel telefono: la foto non va da nessuna parte.
 * Restituisce le righe lette con i 4 angoli, nell'ordine alto-sinistra, alto-destra, basso-destra, basso-sinistra:
 * le righe vere dello scontrino le ricostruisce src/engine/receipt.ts (groupRows).
 */
class ReceiptOcrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ReceiptOcr")

    AsyncFunction("recognize") { uri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("E_CONTEXT", "App non pronta", null)
        return@AsyncFunction
      }
      val image = try {
        InputImage.fromFilePath(context, Uri.parse(uri))   // tiene conto della rotazione della foto (EXIF)
      } catch (e: Exception) {
        promise.reject("E_IMAGE", "Non riesco ad aprire la foto", e)
        return@AsyncFunction
      }
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      recognizer.process(image)
        .addOnSuccessListener { result ->
          val out = ArrayList<Map<String, Any>>()
          for (block in result.textBlocks) {
            for (line in block.lines) {
              val pts = line.cornerPoints ?: continue
              if (pts.size < 4) continue
              out.add(mapOf(
                "text" to line.text,
                "box" to pts.take(4).map { listOf(it.x.toDouble(), it.y.toDouble()) },
              ))
            }
          }
          recognizer.close()
          promise.resolve(out)
        }
        .addOnFailureListener { e ->
          recognizer.close()
          promise.reject("E_OCR", e.message ?: "Lettura non riuscita", e)
        }
    }
  }
}
