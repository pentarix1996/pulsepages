import type { Theme } from '@shared/domain.ts'
import { formatStamp } from '@/lib/status-page/time'
import { InlineScript, scriptJson } from './InlineScript'
import { themeStorageKey, TIME_ZONE_STORAGE_KEY } from './storage'

/**
 * First child of the page root. Runs while the HTML is parsed, before the first paint:
 *  - applies the theme (visitor's choice for this page, else the page default, else prefers-color-scheme),
 *  - picks the time zone (visitor's choice, else the browser's) and defines window.__upvT, which every <LocalTime>
 *    calls right after its <time> element to re-format it in that zone.
 */
export function bootstrapScript(projectId: string, themeDefault: Theme): string {
  return (
    '(function(){var r=document.currentScript&&document.currentScript.parentElement;' +
    `try{var t=localStorage.getItem(${scriptJson(themeStorageKey(projectId))}),d=${scriptJson(themeDefault)};` +
    "var k=t==='dark'||(t!=='light'&&(d==='dark'||(d==='system'&&!!window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)));" +
    "if(r)r.classList.toggle('dark',k)}catch(e){}" +
    `var z=null;try{z=localStorage.getItem(${scriptJson(TIME_ZONE_STORAGE_KEY)});if(z)new Intl.DateTimeFormat('en-US',{timeZone:z})}catch(e){z=null}` +
    'if(!z){try{z=Intl.DateTimeFormat().resolvedOptions().timeZone}catch(e){}}' +
    `window.__upvTz=z||'UTC';var F=(${formatStamp.toString()});` +
    "window.__upvT=function(s){var el=s&&s.previousElementSibling;if(!el||el.tagName!=='TIME')return;" +
    "try{el.textContent=F(el.getAttribute('datetime'),el.getAttribute('data-f'),window.__upvTz,el.getAttribute('data-rel'))}catch(e){}}})();"
  )
}

export function StatusBootstrap({ projectId, themeDefault }: { projectId: string; themeDefault: Theme }) {
  return <InlineScript code={bootstrapScript(projectId, themeDefault)} />
}
