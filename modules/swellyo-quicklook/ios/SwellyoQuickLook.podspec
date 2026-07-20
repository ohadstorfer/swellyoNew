Pod::Spec.new do |s|
  s.name           = 'SwellyoQuickLook'
  s.version        = '1.0.0'
  s.summary        = 'In-app document preview via QLPreviewController'
  s.description    = 'Presents a local file (Office/RTF/PDF/images) using Apple QuickLook.'
  s.author         = 'Swellyo'
  s.homepage       = 'https://github.com/ohadstorfer/swellyoNew'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'QuickLook'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
