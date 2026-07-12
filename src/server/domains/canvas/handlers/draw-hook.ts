/**
 * canvas_inject_draw_hook — install / read / uninstall a draw-call interceptor.
 *
 * Wraps Canvas 2D (`drawImage` / `fillText` / `strokeText`) and WebGL
 * (`drawArrays` / `drawElements`) prototype methods, recording each invocation
 * into a ring buffer on `window.__jshookDrawLog`. Persistent mode re-injects
 * on every navigation via `Page.addScriptToEvaluateOnNewDocument`.
 *
 * Use case: obfuscated / VM-protected canvas games where the scene tree is
 * hidden — the only way to tell *what* is being rendered frame-by-frame is to
 * intercept the draw calls themselves.
 */
import type { ToolResponse } from '@server/types';
import { asJsonResponse } from '@server/domains/shared/response';
import { argBool, argNumber, argEnum } from '@server/domains/shared/parse-args';
import type { PageController } from '@server/domains/canvas/dependencies';

const ACTIONS = new Set(['install', 'read', 'uninstall'] as const);

interface PersistentCapablePageController {
  evaluateOnNewDocument?(script: string): Promise<unknown>;
}

function buildInstallScript(maxEntries: number): string {
  const cap = Math.max(1, Math.floor(maxEntries));
  return (
    '(function(){' +
    `var MAX=${cap};` +
    'if(window.__jshookDrawHookInstalled){return{installed:true,alreadyInstalled:true,entryCount:(window.__jshookDrawLog||[]).length};}' +
    'var log=[];window.__jshookDrawLog=log;var orig={};' +
    'function ser(args){var out=[];for(var i=0;i<Math.min(args.length,6);i++){var v=args[i];var t=typeof v;if(t==="string"){out.push(v.length>200?v.slice(0,200)+"…":v);}else if(t==="number"||t==="boolean"){out.push(v);}else if(v==null){out.push(null);}else{out.push("["+t+"]");}}return out;}' +
    'function record(kind,args,ctx){if(log.length>=MAX){log.shift();}var entry={kind:kind,args:ser(args),t:Date.now()};var canvas=ctx&&ctx.canvas;if(canvas&&canvas.id){entry.canvasId=canvas.id;}log.push(entry);}' +
    'var c2d=window.CanvasRenderingContext2D&&window.CanvasRenderingContext2D.prototype;' +
    'if(c2d){["drawImage","fillText","strokeText"].forEach(function(fn){if(typeof c2d[fn]!=="function"){return;}orig[fn]=c2d[fn];c2d[fn]=function(){try{record(fn,arguments,this);}catch(e){}return orig[fn].apply(this,arguments);};});}' +
    'function hookGL(Ctor,name){if(!Ctor||!Ctor.prototype){return;}var p=Ctor.prototype;["drawArrays","drawElements"].forEach(function(fn){if(typeof p[fn]!=="function"){return;}var key=name+"."+fn;orig[key]=p[fn];p[fn]=function(){try{record(fn,arguments,this);}catch(e){}return orig[key].apply(this,arguments);};});}' +
    'hookGL(window.WebGLRenderingContext,"webgl");hookGL(window.WebGL2RenderingContext,"webgl2");' +
    'window.__jshookDrawOrig=orig;window.__jshookDrawHookInstalled=true;return{installed:true};' +
    '})()'
  );
}

function buildReadScript(clear: boolean): string {
  return (
    '(function(){' +
    'var log=window.__jshookDrawLog||[];var copy=log.slice();' +
    `if(${clear}){log.length=0;}` +
    'return{entries:copy,count:copy.length,installed:!!window.__jshookDrawHookInstalled};' +
    '})()'
  );
}

function buildUninstallScript(): string {
  return (
    '(function(){' +
    'if(!window.__jshookDrawHookInstalled){return{uninstalled:false,notInstalled:true};}' +
    'var orig=window.__jshookDrawOrig||{};' +
    'var c2d=window.CanvasRenderingContext2D&&window.CanvasRenderingContext2D.prototype;' +
    'if(c2d){["drawImage","fillText","strokeText"].forEach(function(fn){if(orig[fn]){c2d[fn]=orig[fn];}});}' +
    '["webgl","webgl2"].forEach(function(name){var Ctor=name==="webgl"?window.WebGLRenderingContext:window.WebGL2RenderingContext;var p=Ctor&&Ctor.prototype;if(!p){return;}["drawArrays","drawElements"].forEach(function(fn){var key=name+"."+fn;if(orig[key]){p[fn]=orig[key];}});});' +
    'window.__jshookDrawHookInstalled=false;return{uninstalled:true};' +
    '})()'
  );
}

export async function handleDrawHook(
  pageController: PageController,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const action = argEnum(args, 'action', ACTIONS, 'install');
  const persistent = argBool(args, 'persistent', false);
  const maxEntries = argNumber(args, 'maxEntries', 1000);
  const clear = argBool(args, 'clear', false);

  try {
    if (action === 'install') {
      const script = buildInstallScript(maxEntries);
      const persistentCapable = pageController as unknown as PersistentCapablePageController;
      const persistentApplied =
        persistent && typeof persistentCapable.evaluateOnNewDocument === 'function';
      if (persistentApplied) {
        await persistentCapable.evaluateOnNewDocument!(script);
      }
      const result = await pageController.evaluate<Record<string, unknown>>(script);
      return asJsonResponse({
        action: 'install',
        persistent: persistentApplied,
        ...result,
        ...(persistent && !persistentApplied
          ? {
              persistentNote:
                'evaluateOnNewDocument unavailable on this controller; hook installed for the current page only',
            }
          : {}),
      });
    }

    if (action === 'read') {
      const result = await pageController.evaluate<Record<string, unknown>>(buildReadScript(clear));
      return asJsonResponse({ action: 'read', clear, ...result });
    }

    const result = await pageController.evaluate<Record<string, unknown>>(buildUninstallScript());
    return asJsonResponse({ action: 'uninstall', ...result });
  } catch (error) {
    return asJsonResponse({
      action,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
