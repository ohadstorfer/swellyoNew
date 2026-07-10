Pod::Spec.new do |s|
  s.name           = 'KeyboardPassthrough'
  s.version        = '1.0.0'
  s.summary        = 'Swap the system keyboard for a transparent inputView'
  s.description    = 'Replaces the focused responder\'s inputView with a transparent view of the keyboard\'s height, so the app shows through without dismissing the keyboard.'
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
