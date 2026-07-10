Pod::Spec.new do |s|
  s.name           = 'KeyboardDirection'
  s.version        = '1.0.0'
  s.summary        = 'Active keyboard writing direction (ltr/rtl)'
  s.description    = 'Reports whether the active keyboard input mode is RTL or LTR.'
  s.author         = 'Swellyo'
  s.homepage       = 'https://github.com/ohadstorfer/swellyoNew'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
