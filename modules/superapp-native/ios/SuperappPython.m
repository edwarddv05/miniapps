#define PY_SSIZE_T_CLEAN
#include <Python/Python.h>

#import "SuperappPython.h"
#import <JavaScriptCore/JavaScriptCore.h>

// The interpreter lives as long as the app. The build copies the standard
// library to <bundle>/python, the app's own modules to <bundle>/app and the
// pure-Python packages (yt-dlp, gallery-dl…) to <bundle>/app_packages.

static PyObject *dispatchFunction = NULL;
static NSString *startFailure = nil;

#pragma mark - _superapp module

// Runs a script in a fresh JavaScriptCore context and returns what it printed
// with console.log. yt-dlp's YouTube challenge solver prints its JSON answer.
static PyObject *superapp_js_eval(PyObject *self, PyObject *args) {
  const char *code = NULL;
  if (!PyArg_ParseTuple(args, "s", &code)) return NULL;
  NSString *script = [NSString stringWithUTF8String:code];
  __block NSString *failure = nil;
  NSString *output = nil;

  Py_BEGIN_ALLOW_THREADS
  @autoreleasepool {
    JSContext *context = [[JSContext alloc] init];
    NSMutableArray<NSString *> *lines = [NSMutableArray array];
    JSValue *console = [JSValue valueWithNewObjectInContext:context];
    console[@"log"] = ^{
      NSMutableArray<NSString *> *parts = [NSMutableArray array];
      for (JSValue *value in [JSContext currentArguments]) [parts addObject:[value toString] ?: @""];
      [lines addObject:[parts componentsJoinedByString:@" "]];
    };
    console[@"warn"] = ^{};
    console[@"error"] = ^{};
    console[@"debug"] = ^{};
    context[@"console"] = console;
    context.exceptionHandler = ^(JSContext *ctx, JSValue *exception) {
      failure = [exception toString] ?: @"JavaScript exception";
    };
    [context evaluateScript:script];
    output = [lines componentsJoinedByString:@"\n"];
  }
  Py_END_ALLOW_THREADS

  if (failure) {
    PyErr_SetString(PyExc_RuntimeError, failure.UTF8String);
    return NULL;
  }
  return PyUnicode_FromString(output.UTF8String);
}

static PyMethodDef superappMethods[] = {
  {"js_eval", superapp_js_eval, METH_VARARGS, "Evaluate JavaScript with JavaScriptCore."},
  {NULL, NULL, 0, NULL},
};

static struct PyModuleDef superappModule = {
  PyModuleDef_HEAD_INIT, "_superapp", NULL, -1, superappMethods,
};

static PyObject *PyInit__superapp(void) {
  return PyModule_Create(&superappModule);
}

#pragma mark - Interpreter

static NSString *currentExceptionText(void) {
  PyObject *exception = PyErr_GetRaisedException();
  if (!exception) return @"Python error";
  PyObject *text = PyObject_Str(exception);
  NSString *message = text && PyUnicode_Check(text) ? [NSString stringWithUTF8String:PyUnicode_AsUTF8(text)] : @"Python error";
  Py_XDECREF(text);
  Py_DECREF(exception);
  return message;
}

static BOOL appendPath(PyConfig *config, NSString *path) {
  wchar_t *wide = Py_DecodeLocale(path.fileSystemRepresentation, NULL);
  if (!wide) return NO;
  PyStatus status = PyWideStringList_Append(&config->module_search_paths, wide);
  PyMem_RawFree(wide);
  return !PyStatus_Exception(status);
}

static NSString *startInterpreter(void) {
  NSString *resources = NSBundle.mainBundle.resourcePath;
  NSString *home = [resources stringByAppendingPathComponent:@"python"];
  NSString *libRoot = [home stringByAppendingPathComponent:@"lib"];
  NSString *version = nil;
  for (NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:libRoot error:nil]) {
    if ([name hasPrefix:@"python3."]) version = name;
  }
  if (!version) return @"Falta la biblioteca de Python en la app.";
  NSString *stdlib = [libRoot stringByAppendingPathComponent:version];

  PyPreConfig preConfig;
  PyPreConfig_InitIsolatedConfig(&preConfig);
  preConfig.utf8_mode = 1;
  PyStatus status = Py_PreInitialize(&preConfig);
  if (PyStatus_Exception(status)) return [NSString stringWithFormat:@"Python: %s", status.err_msg ?: "preinit"];

  if (PyImport_AppendInittab("_superapp", PyInit__superapp) == -1) return @"Python: _superapp";

  PyConfig config;
  PyConfig_InitIsolatedConfig(&config);
  config.buffered_stdio = 0;
  config.write_bytecode = 0;
  config.install_signal_handlers = 1;
  status = PyConfig_SetBytesString(&config, &config.home, home.fileSystemRepresentation);
  if (PyStatus_Exception(status)) {
    PyConfig_Clear(&config);
    return @"Python: home";
  }
  config.module_search_paths_set = 1;
  NSArray<NSString *> *paths = @[
    stdlib,
    [stdlib stringByAppendingPathComponent:@"lib-dynload"],
    [resources stringByAppendingPathComponent:@"app"],
    [resources stringByAppendingPathComponent:@"app_packages"],
  ];
  for (NSString *path in paths) {
    if (!appendPath(&config, path)) {
      PyConfig_Clear(&config);
      return @"Python: path";
    }
  }
  status = Py_InitializeFromConfig(&config);
  PyConfig_Clear(&config);
  if (PyStatus_Exception(status)) return [NSString stringWithFormat:@"Python: %s", status.err_msg ?: "init"];

  NSString *failure = nil;
  PyObject *module = PyImport_ImportModule("superapp_dl");
  if (module) {
    dispatchFunction = PyObject_GetAttrString(module, "dispatch");
    Py_DECREF(module);
    if (!dispatchFunction) failure = currentExceptionText();
  } else {
    failure = currentExceptionText();
  }
  // Downloads run on Python threads; native calls take the lock when they need it.
  PyEval_SaveThread();
  return failure;
}

NSString *SuperappPythonStart(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    startFailure = startInterpreter();
  });
  return startFailure;
}

NSString *SuperappPythonCall(NSString *name, NSString *payload) {
  NSString *failure = SuperappPythonStart();
  if (failure || !dispatchFunction) {
    NSDictionary *envelope = @{@"ok": @NO, @"error": [NSString stringWithFormat:@"El descargador no pudo iniciar. %@", failure ?: @""]};
    NSData *data = [NSJSONSerialization dataWithJSONObject:envelope options:0 error:nil];
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  }
  NSString *result = nil;
  PyGILState_STATE state = PyGILState_Ensure();
  PyObject *value = PyObject_CallFunction(dispatchFunction, "ss", name.UTF8String, payload.UTF8String);
  if (value && PyUnicode_Check(value)) {
    const char *text = PyUnicode_AsUTF8(value);
    if (text) result = [NSString stringWithUTF8String:text];
  }
  if (!value || !result) PyErr_Clear();
  Py_XDECREF(value);
  PyGILState_Release(state);
  return result ?: @"{\"ok\":false,\"error\":\"No se pudo ejecutar el descargador.\"}";
}
