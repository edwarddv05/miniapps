Pod::Spec.new do |s|
  s.name           = 'SuperappNative'
  s.version        = '1.0.0'
  s.summary        = 'Embedded yt-dlp, media joining and widget data for My SuperApp'
  s.author         = 'My SuperApp'
  s.homepage       = 'https://github.com/edwarddv05/miniapps'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  # Downloaded by scripts/ipa/fetch-python.sh; not kept in git.
  s.vendored_frameworks = 'Python.xcframework'
  s.frameworks = 'AVFoundation', 'CoreImage', 'JavaScriptCore', 'WidgetKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER' => 'NO',
  }

  s.source_files = '*.{h,m,swift}'
  s.public_header_files = 'SuperappPython.h'
end
