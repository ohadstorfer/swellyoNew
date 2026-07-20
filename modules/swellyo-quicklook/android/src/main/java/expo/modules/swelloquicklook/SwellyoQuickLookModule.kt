package expo.modules.swelloquicklook

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android stub so autolinking's Android pass finds a module. QuickLook is
 * iOS-only; JS never calls preview() on Android (FileBubble gates on
 * Platform.OS === 'ios'), so this exposes no functions.
 */
class SwellyoQuickLookModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SwellyoQuickLook")
  }
}
