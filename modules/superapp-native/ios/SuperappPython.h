#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Starts the embedded interpreter once. Returns nil when it is ready, or why it is not.
FOUNDATION_EXPORT NSString * _Nullable SuperappPythonStart(void);

/// Calls `superapp_dl.dispatch(name, payload)`; always returns a JSON envelope.
FOUNDATION_EXPORT NSString *SuperappPythonCall(NSString *name, NSString *payload);

NS_ASSUME_NONNULL_END
