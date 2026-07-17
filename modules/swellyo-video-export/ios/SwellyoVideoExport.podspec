Pod::Spec.new do |s|
  s.name           = 'SwellyoVideoExport'
  s.version        = '1.0.0'
  s.summary        = 'Off-thread H.264 720p video transcode via AVAssetExportSession'
  s.description    = 'Shrinks a picked video before upload, without blocking the picker.'
  s.author         = 'Swellyo'
  s.homepage       = 'https://github.com/ohadstorfer/swellyoNew'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
