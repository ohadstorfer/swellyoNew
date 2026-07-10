package expo.modules.keyboarddirection

import android.content.Context
import android.os.Build
import android.text.TextUtils
import android.view.View
import android.view.inputmethod.InputMethodManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

/**
 * Pull-only counterpart of the iOS module. Android has no reliable broadcast
 * for language switches WITHIN one keyboard app (Gboard EN -> Gboard HE), so
 * there is no onChange event here — JS polls getDirection() on focus,
 * keyboardDidShow, and every keystroke instead (see useKeyboardDirection).
 */
class KeyboardDirectionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KeyboardDirection")

    Function("getDirection") {
      val context = appContext.reactContext ?: return@Function null
      val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        ?: return@Function null
      val subtype = imm.currentInputMethodSubtype ?: return@Function null
      val tag: String? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && subtype.languageTag.isNotEmpty()) {
          subtype.languageTag
        } else {
          @Suppress("DEPRECATION")
          subtype.locale
        }
      if (tag.isNullOrEmpty()) return@Function null
      // Legacy subtype.locale uses underscores ("he_IL"); BCP-47 wants dashes.
      val locale = Locale.forLanguageTag(tag.replace('_', '-'))
      if (TextUtils.getLayoutDirectionFromLocale(locale) == View.LAYOUT_DIRECTION_RTL) "rtl" else "ltr"
    }
  }
}
