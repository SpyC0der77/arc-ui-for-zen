"""Native debug lifecycle checks in a disposable Zen session.

Launch with --marionette and MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 as documented
in interactive.py. Usage: python tests/debug-lifecycle.py [port]
The last check destroys the window-local debug controller; restart afterward.
"""
import base64
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'artifacts/test-python'))
from marionette_driver.marionette import Marionette

m = Marionette('localhost', port=int(sys.argv[1]) if len(sys.argv) > 1 else 2828,
               socket_timeout=20)
m.start_session()
m.set_context('chrome')
evidence = ROOT / 'artifacts/debug-mode'
evidence.mkdir(parents=True, exist_ok=True)

try:
    assert m.execute_script('return !!window.ZenArc?.debug?.available'), (
        'Debug mode is unavailable; use a regular disposable window with Workspaces enabled')
    for opened in [True, False]:
        result = m.execute_async_script("""
          const opened=arguments[0],done=arguments[arguments.length-1];
          (async()=>{
            const library=document.querySelector('zen-library');
            async function settle(){
              for(let i=0;i<60&&library.hasAttribute('transitioning');i++)await new Promise(r=>setTimeout(r,25));
            }
            library.activeTab='downloads';
            await ZenArc.setRail(opened);
            await settle();
            await ZenArc.debug.toggle();
            await ZenArc.debug.reset();
            await ZenArc.debug.disable();
            await settle();
            done({rail:ZenArc.diagnostics().rail,section:library.activeTab});
          })().catch(e=>done({error:String(e)}));
        """, script_args=[opened])
        assert result == {'rail': opened, 'section': 'downloads'}, result
        print(f'PASS: reset/disable restores original rail={opened} and section')
        if opened:
            (evidence / 'after-review-rail.png').write_bytes(
                base64.b64decode(m.screenshot()))

    history = m.execute_async_script("""
      const done=arguments[arguments.length-1];
      (async()=>{
        const library=document.querySelector('zen-library');
        Services.prefs.setBoolPref('zen.library.history.closed-tabs',false);
        library.activeTab='history';await library.updateComplete;
        const section=library.querySelector('zen-library-history-section');
        section.activeFilters.delete('source:closed');section.activeFilters.add('source:history');
        section.onFiltersChanged();await ZenArc.setRail(true);
        await new Promise(r=>setTimeout(r,400));
        await ZenArc.debug.toggle();
        gURLBar.search('archive');const context=await gURLBar.lastQueryContextPromise;
        const result=context.results.find(r=>r.payload.commandId==='archive');
        gURLBar.view.selectedRowIndex=result.rowIndex;
        gURLBar.handleCommand(new KeyboardEvent('keydown',{key:'Enter',code:'Enter'}));
        for(let i=0;i<40&&!section.activeFilters.has('source:closed');i++)await new Promise(r=>setTimeout(r,25));
        const ranArchive=Services.prefs.getBoolPref('zen.library.history.closed-tabs');
        await ZenArc.debug.disable();await library.updateComplete;
        done({ranArchive,closed:Services.prefs.getBoolPref('zen.library.history.closed-tabs'),
          history:section.activeFilters.has('source:history'),archive:section.activeFilters.has('source:closed')});
      })().catch(e=>done({error:String(e)}));
    """)
    assert history == {'ranArchive': True, 'closed': False, 'history': True, 'archive': False}, history
    print('PASS: Archive command during debug restores History filters and persistent mode')

    result = m.execute_async_script("""
      const done=arguments[arguments.length-1];
      (async()=>{
        const manager=gZenWorkspaces,original=manager.createAndSaveWorkspace;
        const baseline=manager.getWorkspaces().length;
        let release,reached,calls=0;
        const paused=new Promise(resolve=>reached=resolve);
        const gate=new Promise(resolve=>release=resolve);
        manager.createAndSaveWorkspace=async function(...args){
          calls++;
          const space=await original.apply(this,args);
          reached();await gate;return space;
        };
        try {
          const activation=ZenArc.debug.toggle().catch(error=>String(error));
          await paused;
          ZenArc.debug.destroy();
          release();
          const error=await activation;
          await ZenArc.debug.disable();
          done({calls,baseline,spaces:manager.getWorkspaces().length,
            enabled:ZenArc.debug.enabled,
            journal:Services.prefs.getStringPref('arc-ui.debug.owned-data',''),error});
        } finally {manager.createAndSaveWorkspace=original;release();}
      })().catch(e=>done({error:String(e)}));
    """)
    assert result['calls'] == 1, result
    assert result['spaces'] == result['baseline'], result
    assert not result['enabled'] and not result['journal'], result
    assert 'closed during activation' in result['error'], result
    print('PASS: destroy during activation cancels before the next Space and serializes cleanup')
finally:
    m.delete_session()
