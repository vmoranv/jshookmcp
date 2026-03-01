export const ANTI_DEBUG_DETECT_SCRIPTS = {
  detectProtections: `(async function () {
  function pushUnique(list, value) {
    if (list.indexOf(value) === -1) {
      list.push(value);
    }
  }

  var findings = [];
  var recommendations = [];

  function addFinding(type, severity, evidence, strategy) {
    findings.push({
      type: type,
      severity: severity,
      evidence: evidence,
      recommendedBypass: strategy
    });
    pushUnique(recommendations, strategy);
  }

  var inlineScripts = [];
  try {
    var scriptNodes = document.querySelectorAll('script');
    for (var i = 0; i < scriptNodes.length; i += 1) {
      var node = scriptNodes[i];
      if (!node.src && typeof node.textContent === 'string' && node.textContent.trim().length > 0) {
        inlineScripts.push(node.textContent.slice(0, 200000));
      }
    }
  } catch (_) {}

  var externalScripts = [];
  try {
    var externalCount = 0;
    var allScriptNodes = document.querySelectorAll('script[src]');
    for (var j = 0; j < allScriptNodes.length; j += 1) {
      if (externalCount >= 8) {
        break;
      }

      var scriptSrc = allScriptNodes[j].src;
      if (!scriptSrc) {
        continue;
      }

      try {
        var absoluteUrl = new URL(scriptSrc, location.href);
        if (absoluteUrl.origin !== location.origin) {
          continue;
        }

        var response = await fetch(absoluteUrl.href, { credentials: 'same-origin' });
        if (!response.ok) {
          continue;
        }

        var text = await response.text();
        externalScripts.push(text.slice(0, 200000));
        externalCount += 1;
      } catch (_) {}
    }
  } catch (_) {}

  var sourceBlob = (inlineScripts.join('\\n') + '\\n' + externalScripts.join('\\n')).toLowerCase();

  var debuggerTimerPattern = /(setinterval|settimeout)[\\s\\S]{0,180}debugger|debugger\\s*;/i;
  if (debuggerTimerPattern.test(sourceBlob)) {
    addFinding(
      'debugger_statement',
      'high',
      'Found debugger statements or timer-driven debugger triggers in script sources.',
      'antidebug_bypass_debugger_statement'
    );
  }

  var timingPattern = /(performance\\.now\\s*\\(|date\\.now\\s*\\()[\\s\\S]{0,120}(>|>=|<|<=|===|!==)[\\s\\S]{0,60}(50|100|200|500|1000)/i;
  if (timingPattern.test(sourceBlob)) {
    addFinding(
      'timing_check',
      'high',
      'Found timing delta logic around performance.now()/Date.now().',
      'antidebug_bypass_timing'
    );
  }

  var stackPattern = /(new\\s+error\\s*\\(|error\\s*\\(|\\.stack\\b|preparestacktrace)/i;
  if (stackPattern.test(sourceBlob)) {
    addFinding(
      'stack_trace_check',
      'medium',
      'Found Error.stack or stack trace analysis patterns.',
      'antidebug_bypass_stack_trace'
    );
  }

  var consolePattern = /(console\\.(log|clear|table|debug|dir|trace)\\s*\\(|console\\s*=|Object\\.defineProperty\\s*\\(\\s*console)/i;
  if (consolePattern.test(sourceBlob)) {
    addFinding(
      'console_detect',
      'medium',
      'Found console instrumentation or console-based detection patterns.',
      'antidebug_bypass_console_detect'
    );
  }

  var devtoolsSizePattern = /(outerheight\\s*-\\s*innerheight|outerwidth\\s*-\\s*innerwidth|innerheight\\s*<\\s*outerheight|innerwidth\\s*<\\s*outerwidth)/i;
  if (devtoolsSizePattern.test(sourceBlob)) {
    addFinding(
      'devtools_window_check',
      'low',
      'Found outer/inner window dimension comparison likely used for devtools panel detection.',
      'antidebug_bypass_all'
    );
  }

  var overwrittenConsoleMethods = [];
  var nativeCodePattern = /\\{\\s*\\[native code\\]\\s*\\}/i;
  var runtimeMethods = ['log', 'debug', 'info', 'warn', 'error', 'table', 'clear'];
  for (var k = 0; k < runtimeMethods.length; k += 1) {
    var methodName = runtimeMethods[k];
    try {
      var candidate = console[methodName];
      if (typeof candidate !== 'function') {
        overwrittenConsoleMethods.push(methodName + ':non-function');
        continue;
      }

      var fnSource = Function.prototype.toString.call(candidate);
      if (!nativeCodePattern.test(fnSource)) {
        overwrittenConsoleMethods.push(methodName);
      }
    } catch (_) {}
  }

  if (overwrittenConsoleMethods.length > 0) {
    addFinding(
      'console_runtime_overwrite',
      'medium',
      'Runtime console methods appear wrapped/overwritten: ' + overwrittenConsoleMethods.join(', '),
      'antidebug_bypass_console_detect'
    );
  }

  return {
    success: true,
    detected: findings.length > 0,
    count: findings.length,
    protections: findings,
    recommendations: recommendations,
    evidence: {
      scannedInlineScripts: inlineScripts.length,
      scannedExternalScripts: externalScripts.length,
      sourceBytesApprox: sourceBlob.length
    }
  };
})();`,
} as const;
