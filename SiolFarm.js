/* FarmGod – Trim V3 (setup-before-build + availability filter + pretty sliders + ENTER workflow)
 * by Vasia & Ethical Hacker GPT
 *
 * PART 1/2: Library + Translation (safe to run alone; no boot)
 *
 * What’s new vs your base script:
 * - Trim sliders (Rams/Light/Axe/Catapult/Scout) live inside the Options dialog, BEFORE you press Trim.
 * - The Trim list is filtered STRICTLY by origin availability (reads Combined -> unit pool).
 * - Enter on am_farm opens FIRST Rally row (real user gesture) and, if tab opened, removes the row (queue-like).
 * - In Rally tab: Enter → Confirm, Enter → Send, then auto-close.
 * - After building, a compact Prefill panel lets you tweak numbers used for the Rally form (without refilter).
 * - “Rebuild with these numbers” re-runs Trim (strict filter) using the current Prefill values.
 * - All code uses compat-friendly JS (no optional chaining/nullish).
 */

ScriptAPI.register('FarmGod', true, 'Warre', 'nl.tribalwars@coma.innogames.de');

window.FarmGod = {};

// =========================
// Library (queues + helpers)
// =========================
window.FarmGod.Library = (function () {
  // ---- twLib init (ajax/get/post/openWindow with queues & retries)
  if (typeof window.twLib === 'undefined') {
    window.twLib = {
      queues: null,
      init: function () {
        if (this.queues === null) this.queues = this.queueLib.createQueues(5);
      },
      queueLib: {
        maxAttempts: 3,
        Item: function (action, arg, promise) {
          this.action = action;
          this.arguments = arg;
          this.promise = promise || null;
          this.attempts = 0;
        },
        Queue: function () {
          this.list = [];
          this.working = false;
          this.length = 0;
          this.doNext = function () {
            var item = this.dequeue();
            var self = this;
            if (!item) { this.working = false; return; }
            if (item.action == 'openWindow') {
              var w = window.open.apply(window, item.arguments);
              if (!w) { if (item.promise) item.promise.reject('Popup blocked'); return self.start(); }
              w.addEventListener('DOMContentLoaded', function () { self.start(); });
            } else {
              $[item.action].apply($, item.arguments)
                .done(function () { if (item.promise) item.promise.resolve.apply(null, arguments); self.start(); })
                .fail(function () {
                  item.attempts += 1;
                  if (item.attempts < twLib.queueLib.maxAttempts) {
                    self.enqueue(item, true);
                  } else {
                    if (item.promise) item.promise.reject.apply(null, arguments);
                  }
                  self.start();
                });
            }
          };
          this.start = function () { if (this.length) { this.working = true; this.doNext(); } else { this.working = false; } };
          this.dequeue = function () { this.length -= 1; return this.list.shift(); };
          this.enqueue = function (item, front) {
            if (front) this.list.unshift(item); else this.list.push(item);
            this.length += 1;
            if (!this.working) this.start();
          };
        },
        createQueues: function (amount) { var arr = []; for (var i = 0; i < amount; i++) arr[i] = new twLib.queueLib.Queue(); return arr; },
        addItem: function (item) {
          var least = twLib.queues.map(function(q){return q.length;}).reduce(function(next, curr){ return (curr < next) ? curr : next; }, 0);
          twLib.queues[least].enqueue(item);
        },
        orchestrator: function (type, arg) { var p = $.Deferred(); var it = new twLib.queueLib.Item(type, arg, p); twLib.queueLib.addItem(it); return p; }
      },
      ajax: function () { return twLib.queueLib.orchestrator('ajax', arguments); },
      get: function () { return twLib.queueLib.orchestrator('get', arguments); },
      post: function () { return twLib.queueLib.orchestrator('post', arguments); },
      openWindow: function () { var item = new twLib.queueLib.Item('openWindow', arguments); twLib.queueLib.addItem(item); }
    };
    twLib.init();
  }

  // ---- Unit speeds cache
  var setUnitSpeeds = function () {
    var unitSpeeds = {};
    $.when($.get('/interface.php?func=get_unit_info')).then(function (xml) {
      $(xml).find('config').children().map(function (i, el) {
        unitSpeeds[$(el).prop('nodeName')] = $(el).find('speed').text().toNumber();
      });
      localStorage.setItem('FarmGod_unitSpeeds', JSON.stringify(unitSpeeds));
    });
  };
  var getUnitSpeeds = function () { return JSON.parse(localStorage.getItem('FarmGod_unitSpeeds')) || false; };
  if (!getUnitSpeeds()) setUnitSpeeds();

  // ---- Paging helpers (am_farm / scavenge / overview)
  var determineNextPage = function (page, $html) {
    var villageLength = ($html.find('#scavenge_mass_screen').length > 0)
      ? $html.find('tr[id*="scavenge_village"]').length
      : $html.find('tr.row_a, tr.row_ax, tr.row_b, tr.row_bx').length;

    var navSelect = $html.find('.paged-nav-item').first().closest('td').find('select').first();
    var navLength = ($html.find('#am_widget_Farm').length > 0)
      ? parseInt($('#plunder_list_nav').first().find('a.paged-nav-item, strong.paged-nav-item')
        [$('#plunder_list_nav').first().find('a.paged-nav-item, strong.paged-nav-item').length - 1]
        .textContent.replace(/\D/g, '')) - 1
      : ((navSelect.length > 0) ? navSelect.find('option').length - 1 : $html.find('.paged-nav-item').not('[href*="page=-1"]').length);

    var pageSize = ($('#mobileHeader').length > 0) ? 10 : parseInt($html.find('input[name="page_size"]').val());
    if (page == -1 && villageLength == 1000) { return Math.floor(1000 / pageSize); }
    else if (page < navLength) { return page + 1; }
    return false;
  };

  var processPage = function (url, page, wrapFn) {
    var pageText = (url.match('am_farm')) ? '&Farm_page=' + page : '&page=' + page;
    return twLib.ajax({ url: url + pageText }).then(function (html) { return wrapFn(page, $(html)); });
  };

  var processAllPages = function (url, processorFn) {
    var page = (url.match('am_farm') || url.match('scavenge_mass')) ? 0 : -1;
    var wrapFn = function (page, $html) {
      var dnp = determineNextPage(page, $html);
      if (dnp) { processorFn($html); return processPage(url, dnp, wrapFn); }
      else { return processorFn($html); }
    };
    return processPage(url, page, wrapFn);
  };

  // ---- Math & time helpers
  var getDistance = function (origin, target) {
    var c1 = origin.toCoord(true), c2 = target.toCoord(true);
    var a = c1.x - c2.x; var b = c1.y - c2.y;
    return Math.hypot(a, b);
  };
  var subtractArrays = function (array1, array2) {
    var result = array1.map(function(val, i){ return val - array2[i]; });
    return (result.some(function(v){ return v < 0; })) ? false : result;
  };
  var getCurrentServerTime = function () {
    var parts = $('#serverTime').closest('p').text().match(/\d+/g);
    var hour=parts[0], min=parts[1], sec=parts[2], day=parts[3], month=parts[4], year=parts[5];
    return new Date(year, (month - 1), day, hour, min, sec).getTime();
  };
  var timestampFromString = function (timestr) {
    var d = $('#serverDate').text().split('/').map(function(x){ return +x; });
    var todayPattern    = new RegExp(window.lang['aea2b0aa9ae1534226518faaefffdaad'].replace('%s', '([\\d+|:]+)')).exec(timestr);
    var tomorrowPattern = new RegExp(window.lang['57d28d1b211fddbb7a499ead5bf23079'].replace('%s', '([\\d+|:]+)')).exec(timestr);
    var laterDatePattern= new RegExp(window.lang['0cb274c906d622fa8ce524bcfbb7552d'].replace('%1', '([\\d+|\\.]+)').replace('%2', '([\\d+|:]+)')).exec(timestr);
    var t, date;
    if (todayPattern !== null) { t = todayPattern[1].split(':'); date = new Date(d[2], (d[1]-1), d[0], t[0], t[1], t[2], (t[3] || 0)); }
    else if (tomorrowPattern !== null) { t = tomorrowPattern[1].split(':'); date = new Date(d[2], (d[1]-1), (d[0]+1), t[0], t[1], t[2], (t[3] || 0)); }
    else { d = (laterDatePattern[1] + d[2]).split('.').map(function(x){ return +x; }); t = laterDatePattern[2].split(':'); date = new Date(d[2], (d[1]-1), d[0], t[0], t[1], t[2], (t[3] || 0)); }
    return date.getTime();
  };

  // ---- prototypes
  String.prototype.toCoord = function (objectified) { var c = (this.match(/\d{1,3}\|\d{1,3}/g) || [false]).pop(); return (c && objectified) ? { x: c.split('|')[0], y: c.split('|')[1] } : c; };
  String.prototype.toNumber = function () { return parseFloat(this); };
  Number.prototype.toNumber = function () { return parseFloat(this); };

  return { getUnitSpeeds: getUnitSpeeds, processPage: processPage, processAllPages: processAllPages, getDistance: getDistance, subtractArrays: subtractArrays, getCurrentServerTime: getCurrentServerTime, timestampFromString: timestampFromString };
})();

// =========================
// Translation (int only)
// =========================
window.FarmGod.Translation = (function () {
  var msg = {
    int: {
      missingFeatures: 'Script requires a premium account and loot assistent!',
      options: {
        title: 'FarmGod Options',
        warning: 'Warning:\n- Make sure A is set as your default microfarm and B as a larger microfarm\n- Make sure the farm filters are set correctly before using the script',
        filterImage: 'https://higamy.github.io/TW/Scripts/Assets/farmGodFilters.png',
        group: 'Send farms from group:',
        distance: 'Maximum fields for farms:',
        time: 'How much time in minutes should there be between farms:',
        losses: 'Send farm to villages with partial losses:',
        maxloot: 'Send a B farm if the last loot was full:',
        newbarbs: 'Add new barbs te farm:',
        button: 'Plan farms',
        trimTitle: 'Trim setup',
        trimHint: 'Only these units are used for Trim. At least one must be > 0. Values are stored per group.'
      },
      table: { noFarmsPlanned: 'No farms can be sent with the specified settings.', origin: 'Origin', target: 'Target', fields: 'fields', farm: 'Farm', goTo: 'Go to' },
      messages: { villageChanged: 'Successfully changed village!', villageError: 'All farms for the current village have been sent!', sendError: 'Error: farm not send!' }
    }
  };
  var get = function () { return msg.int; };
  return { get: get };
})();
/* FarmGod – Trim V3 (setup-before-build + availability filter + pretty sliders + ENTER workflow)
 * by Vasia & Ethical Hacker GPT
 *
 * PART 2/2 (CONSOLIDATED): Main module with:
 * - UI-configurable auto-close for the Rally popup (delay + try-close-on-next-load)
 * - Strict availability filter per origin
 * - Global de-duplication of targets (1 attack per target, keeps the closest origin)
 * - Enter workflow (Enter→Confirm, Enter→Send, Esc→Close)
 * - Prefill panel above Trim list + Rebuild with current numbers
 */

// =========================
// Main
// =========================
window.FarmGod.Main = (function (Library, Translation) {
  var lib = Library;
  var t = Translation.get();

  var curVillage = null;
  var farmBusy = false;

  // defaults
  var DEF_NEED = { ram:10, light:10, axe:0, catapult:0, spy:0 };
  var DEF_CLOSE_DELAY = 1200; // ms (UI adjustable 200–2000)

  function keyForGroup(groupId){ return 'fg_trim_need_' + String(groupId || 0); }
  function loadNeed(groupId){
    try { var raw = localStorage.getItem(keyForGroup(groupId)); if (raw) { var obj = JSON.parse(raw); if (obj && typeof obj === 'object') return obj; } } catch(_){/* noop */}
    return { ram:DEF_NEED.ram, light:DEF_NEED.light, axe:DEF_NEED.axe, catapult:DEF_NEED.catapult, spy:DEF_NEED.spy };
  }
  function saveNeed(groupId, need){ try { localStorage.setItem(keyForGroup(groupId), JSON.stringify(need)); } catch(_){ } }
  function isValidNeed(need){ return (need.ram>0 || need.light>0 || need.axe>0 || need.catapult>0 || need.spy>0); }

  // Group select (ensures Options loads)
  function buildGroupSelect(id) {
    return $.get(TribalWars.buildURL('GET', 'groups', { 'ajax': 'load_group_menu' })).then(function (groups) {
      var html = '<select class="optionGroup">';
      groups.result.map(function (val) {
        html += '<option value="' + val.id + '" ' + ((+id === +val.id) ? 'selected' : '') + '>' + val.name + '</option>';
      });
      html += '</select>';
      return html;
    }).fail(function(){
      return '<select class="optionGroup"><option value="0" selected>All villages</option></select>';
    });
  }

  // -------------------------
  // Rally tab open + UI-configurable auto-close
  // -------------------------
  function openRally(originId, targetCoord, prefillNeed, ac){
    var base = game_data.link_base_pure;
    base = base.replace(/screen=[^&]*/, 'screen=place').replace(/village=\d+/, 'village=' + originId);

    var w = window.open(base, '_blank');
    if (!w) { UI.ErrorMessage('Popup blocked — allow pop-ups.'); return false; }

    var need = prefillNeed || DEF_NEED;
    var delayMs = (ac && ac.delayMs) || DEF_CLOSE_DELAY;
    if (!isFinite(delayMs)) delayMs = DEF_CLOSE_DELAY;
    delayMs = Math.min(2000, Math.max(200, delayMs));
    var tryLoadFirst = (ac && typeof ac.tryLoadFirst !== 'undefined') ? !!ac.tryLoadFirst : true;

    // Persist settings inside popup storage so they survive reloads
    try {
      w.sessionStorage.setItem('FG_CLOSE_DELAY', String(delayMs));
      w.sessionStorage.setItem('FG_TRY_LOAD', tryLoadFirst ? '1' : '0');
    } catch(_){ }

    function inject(){
      try {
        var d = w.document; if (!d || !d.querySelector) return;
        var href = String(w.location.href);
        var isConfirm = /[?&]try=confirm/.test(href);
        var ss = null; try { ss = w.sessionStorage; } catch(_){ }

        var cfgDelay = DEF_CLOSE_DELAY, cfgTryLoad = true;
        if (ss){
          var dm = parseInt(ss.getItem('FG_CLOSE_DELAY'),10);
          if (isFinite(dm)) cfgDelay = Math.min(2000, Math.max(200, dm));
          cfgTryLoad = ss.getItem('FG_TRY_LOAD') !== '0';
        }

        // If previously marked as sent and this is a subsequent load (not confirm) → close immediately
        if (ss && ss.getItem('FG_TRIM_SENT') === '1' && !isConfirm) {
          ss.removeItem('FG_TRIM_SENT');
          try { w.close(); } catch(_){}
          return;
        }

        // Banner + keyboard once per doc
        if (!d.getElementById('tf_banner')){
          var bar=d.createElement('div');
          bar.id='tf_banner';
          bar.setAttribute('style','position:fixed;bottom:8px;right:8px;background:#0b1220;color:#fff;padding:6px 10px;border-radius:8px;border:1px solid #2c3a61;font:12px system-ui;z-index:99999');
          bar.textContent='Trim: Enter → Confirm/Send · Esc → Close';
          d.body.appendChild(bar);
          d.addEventListener('keydown',function(ev){
            var code = (ev.keyCode || ev.which);
            if(code===13){
              var confirmBtn=d.querySelector('#troop_confirm_go, button[id^="troop_confirm_go"], form#command-data-form button[type="submit"]');
              if(confirmBtn){ confirmBtn.click(); return; }
              var attackBtn=d.querySelector('#target_attack, form#units_form button[type="submit"], form[action*="try=confirm"] button[type="submit"]');
              if(attackBtn){ attackBtn.click(); return; }
            } else if(code===27){ try{ w.close(); }catch(_e){} }
          }, true);
        }

        // Prefill on place only
        if (!isConfirm){
          var parts = String(targetCoord).split('|'); var cx = parts[0], cy = parts[1];
          var x = d.querySelector('input[name="x"], #inputx'); var y = d.querySelector('input[name="y"], #inputy');
          if (x && y && cx && cy){ x.value=cx; y.value=cy; }
          function setUnit(name, val){
            var byName = d.querySelector('input[name="'+name+'"]');
            var byId   = d.getElementById('unit_'+name);
            if(byName) byName.value = String(val || 0);
            if(byId)   byId.value   = String(val || 0);
          }
          setUnit('ram', need.ram);
          setUnit('light', need.light);
          setUnit('axe', need.axe);
          setUnit('catapult', need.catapult);
          setUnit('spy', need.spy);
        }

        // Hook confirm submit/click → optional close-on-load, with fallback timeout
        var cmdForm = d.querySelector('form#command-data-form');
        if (cmdForm && !d.__fg_submit_wired){
          d.__fg_submit_wired = true;
          cmdForm.addEventListener('submit', function(){
            try { if (cfgTryLoad) ss.setItem('FG_TRIM_SENT','1'); } catch(_){}
            setTimeout(function(){ try { w.close(); } catch(_e){} }, cfgDelay);
          }, true);
        }
        var sendBtn = d.querySelector('#troop_confirm_submit, .troop_confirm_go[name="submit_confirm"]');
        if (sendBtn && !sendBtn.__fg_click_wired){
          sendBtn.__fg_click_wired = true;
          sendBtn.addEventListener('click', function(){
            try { if (cfgTryLoad) ss.setItem('FG_TRIM_SENT','1'); } catch(_){}
            setTimeout(function(){ try { w.close(); } catch(_e){} }, cfgDelay);
          }, true);
        }

        // Scroll to primary button
        var btn = d.querySelector('#troop_confirm_go, #unit_confirm_go, #target_attack, form#units_form button[type="submit"], button[type="submit"]');
        if (btn && btn.scrollIntoView) btn.scrollIntoView({ block: 'center' });

        // Extra fallback (success text)
        setTimeout(function(){
          try {
            var msgNode=d.querySelector('.confirm-icon.success,.info,.success');
            var txt=(msgNode && msgNode.textContent) || '';
            if(/Command|εντολή|Auftrag|comando|ordem/.test(txt)){
              try { w.close(); } catch(_){}
            }
          } catch(_){ }
        }, Math.max(800, Math.floor(cfgDelay/2)));

      } catch (_){ /* wait */ }
    }

    // Re-inject on every navigation in that popup
    w.addEventListener('load', inject, true);

    return true;
  }

  var lastPrefillNeed = null; // used by Enter handler after build

  var init = function () {
    if (game_data.features.Premium.active && game_data.features.FarmAssistent.active) {
      if (game_data.screen == 'am_farm') {
        $.when(buildOptions()).then(function (html) {
          Dialog.show('FarmGod', html);
          wireOptionsUI();
          var btn = document.querySelector('.optionButton'); if (btn) btn.focus();
        });
      } else {
        location.href = game_data.link_base_pure + 'am_farm';
      }
    } else {
      UI.ErrorMessage(t.missingFeatures);
    }
  };

  // -------------------------
  // Options dialog (with Trim setup)
  // -------------------------
  function presetChipsHTML(){
    return '\
      <div class="fg-presets" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">\
        <a href="#" data-preset="r10l10" class="btn btn-confirm" style="padding:2px 6px;border-radius:6px;">10R/10LC</a>\
        <a href="#" data-preset="l15r10" class="btn" style="padding:2px 6px;border-radius:6px;">15LC/10R</a>\
        <a href="#" data-preset="sc1" class="btn" style="padding:2px 6px;border-radius:6px;">Scout 1</a>\
        <a href="#" data-preset="rOnly" class="btn" style="padding:2px 6px;border-radius:6px;">R-only 10</a>\
        <a href="#" data-preset="lOnly" class="btn" style="padding:2px 6px;border-radius:6px;">LC-only 10</a>\
        <a href="#" data-preset="reset" class="btn" style="padding:2px 6px;border-radius:6px;">Reset</a>\
      </div>\
    ';
  }

  function sliderRowHTML(label, id, val){
    return '\
      <div class="fg-row" style="display:grid;grid-template-columns:90px 1fr 56px;gap:8px;align-items:center;margin:4px 0;">\
        <div style="font-weight:600">'+label+'</div>\
        <input id="'+id+'" type="range" min="0" max="300" step="1" value="'+val+'" style="width:100%">\
        <input id="'+id+'_num" type="number" min="0" max="9999" value="'+val+'" style="width:56px;text-align:center">\
      </div>\
    ';
  }

  function buildOptions(){
    var options = JSON.parse(localStorage.getItem('farmGod_options') || '{}');
    if (!options || typeof options !== 'object') options = {};
    options.optionGroup = (typeof options.optionGroup !== 'undefined') ? options.optionGroup : 0;
    options.optionDistance = (typeof options.optionDistance !== 'undefined') ? options.optionDistance : 25;
    options.optionTime = (typeof options.optionTime !== 'undefined') ? options.optionTime : 10;
    options.optionLosses = (typeof options.optionLosses !== 'undefined') ? options.optionLosses : false;
    options.optionMaxloot = (typeof options.optionMaxloot !== 'undefined') ? options.optionMaxloot : true;
    options.optionNewbarbs = (typeof options.optionNewbarbs !== 'undefined') ? options.optionNewbarbs : true;

    var $templateRows = $('form[action*="action=edit_all"]').find('input[type="hidden"][name*="template"]').closest('tr');
    var templateError = $templateRows.first().find('td').last().text().toNumber() >= $templateRows.last().find('td').last().text().toNumber();

    return $.when(buildGroupSelect(options.optionGroup)).then(function (groupSelect) {
      var need = loadNeed(options.optionGroup);
      return '\
        <div class="optionsContent">\
          <h3>'+t.options.title+'</h3>\
          '+ (templateError ? '<div class="warn">'+t.options.warning+'<br><img src="'+t.options.filterImage+'" style="max-width:100%"></div>' : '') + '\
          <div>'+t.options.group+' '+groupSelect+'</div>\
          <div>'+t.options.distance+' <input class="optionDistance" type="number" value="'+options.optionDistance+'"></div>\
          <div>'+t.options.time+' <input class="optionTime" type="number" value="'+options.optionTime+'"></div>\
          <label><input type="checkbox" class="optionLosses" '+(options.optionLosses ? 'checked' : '')+'> '+t.options.losses+'</label><br>\
          <label><input type="checkbox" class="optionMaxloot" '+(options.optionMaxloot ? 'checked' : '')+'> '+t.options.maxloot+'</label><br>\
          <label><input type="checkbox" class="optionNewbarbs" '+(options.optionNewbarbs ? 'checked' : '')+'> '+t.options.newbarbs+'</label><br><br>\
          <div class="fg-card" style="border:1px solid #ccc;border-radius:8px;padding:10px;background:#f8f8f8">\
            <div style="display:flex;align-items:center;justify-content:space-between;">\
              <div style="font-weight:700">'+t.options.trimTitle+'</div>\
              <small style="opacity:.8">'+t.options.trimHint+'</small>\
            </div>\
            <div class="fg-sliders" style="margin-top:6px">\
              '+sliderRowHTML('Rams','opt_rams', need.ram)+
              sliderRowHTML('Light','opt_light', need.light)+
              sliderRowHTML('Axe','opt_axe', need.axe)+
              sliderRowHTML('Catapult','opt_catapult', need.catapult)+
              sliderRowHTML('Scout','opt_scout', need.spy)+'\
            </div>\
            '+presetChipsHTML()+'\
          </div>\
          <div style="margin-top:10px">\
            <button class="optionButton">'+t.options.button+'</button>\
            <button class="trimButton btn" style="margin-left:8px">Trim</button>\
          </div>\
        </div>\
      ';
    });
  }

  function wireOptionsUI(){
    // PLAN
    $('.optionButton').off('click').on('click', function () {
      var optionGroup     = parseInt($('.optionGroup').val(), 10);
      var optionDistance  = parseFloat($('.optionDistance').val());
      var optionTime      = parseFloat($('.optionTime').val());
      var optionLosses    = $('.optionLosses').prop('checked');
      var optionMaxloot   = $('.optionMaxloot').prop('checked');
      var optionNewbarbs  = $('.optionNewbarbs').prop('checked') || false;

      localStorage.setItem('farmGod_options', JSON.stringify({
        optionGroup: optionGroup, optionDistance: optionDistance, optionTime: optionTime, optionLosses: optionLosses, optionMaxloot: optionMaxloot, optionNewbarbs: optionNewbarbs
      }));

      $('.optionsContent').html(UI.Throbber[0].outerHTML + '<br><br>');

      getData(optionGroup, optionNewbarbs, optionLosses).then(function (data) {
        Dialog.close();
        var plan = createPlanning(optionDistance, optionTime, optionMaxloot, data);

        $('.farmGodContent').remove();
        $('#am_widget_Farm').first().before(buildTable(plan.farms));
        bindEventHandlers();
        UI.InitProgressBars();
        UI.updateProgressBar($('#FarmGodProgessbar'), 0, plan.counter);
        $('#FarmGodProgessbar').data('current', 0).data('max', plan.counter);
      });
    });

    function readNeedFromOptions(){
      function v(id){ var n = parseInt($('#'+id).val(),10); return isFinite(n)?n:0; }
      return { ram:v('opt_rams'), light:v('opt_light'), axe:v('opt_axe'), catapult:v('opt_catapult'), spy:v('opt_scout') };
    }
    function syncPair(id){
      $('#'+id).on('input', function(){ $('#'+id+'_num').val(this.value); updateTrimButton(); });
      $('#'+id+'_num').on('input', function(){ $('#'+id).val(this.value); updateTrimButton(); });
    }
    function updateTrimButton(){
      var group = parseInt($('.optionGroup').val(),10) || 0;
      var need = readNeedFromOptions();
      saveNeed(group, need);
      var ok = isValidNeed(need);
      var $btn = $('.trimButton'); if (ok) $btn.removeAttr('disabled'); else $btn.attr('disabled','disabled');
    }
    syncPair('opt_rams'); syncPair('opt_light'); syncPair('opt_axe'); syncPair('opt_catapult'); syncPair('opt_scout');
    updateTrimButton();

    // Presets
    $('.fg-presets a').off('click').on('click', function(e){
      e.preventDefault();
      var p = $(this).data('preset');
      if (p==='r10l10'){ $('#opt_rams,#opt_rams_num').val(10); $('#opt_light,#opt_light_num').val(10); $('#opt_axe,#opt_axe_num').val(0); $('#opt_catapult,#opt_catapult_num').val(0); $('#opt_scout,#opt_scout_num').val(0); }
      else if (p==='l15r10'){ $('#opt_rams,#opt_rams_num').val(10); $('#opt_light,#opt_light_num').val(15); $('#opt_axe,#opt_axe_num').val(0); $('#opt_catapult,#opt_catapult_num').val(0); $('#opt_scout,#opt_scout_num').val(0); }
      else if (p==='sc1'){ $('#opt_rams,#opt_rams_num').val(0); $('#opt_light,#opt_light_num').val(0); $('#opt_axe,#opt_axe_num').val(0); $('#opt_catapult,#opt_catapult_num').val(0); $('#opt_scout,#opt_scout_num').val(1); }
      else if (p==='rOnly'){ $('#opt_rams,#opt_rams_num').val(10); $('#opt_light,#opt_light_num').val(0); $('#opt_axe,#opt_axe_num').val(0); $('#opt_catapult,#opt_catapult_num').val(0); $('#opt_scout,#opt_scout_num').val(0); }
      else if (p==='lOnly'){ $('#opt_rams,#opt_rams_num').val(0); $('#opt_light,#opt_light_num').val(10); $('#opt_axe,#opt_axe_num').val(0); $('#opt_catapult,#opt_catapult_num').val(0); $('#opt_scout,#opt_scout_num').val(0); }
      else if (p==='reset'){ var n = DEF_NEED; $('#opt_rams,#opt_rams_num').val(n.ram); $('#opt_light,#opt_light_num').val(n.light); $('#opt_axe,#opt_axe_num').val(n.axe); $('#opt_catapult,#opt_catapult_num').val(n.catapult); $('#opt_scout,#opt_scout_num').val(n.spy); }
      updateTrimButton();
    });

    // Trim build
    $('.trimButton').off('click').on('click', function () {
      var optionGroup     = parseInt($('.optionGroup').val(), 10);
      var optionDistance  = parseFloat($('.optionDistance').val());
      var optionNewbarbs  = $('.optionNewbarbs').prop('checked') || false;
      var need = readNeedFromOptions();
      if (!isValidNeed(need)){ UI.ErrorMessage('Set at least one unit > 0'); return; }
      saveNeed(optionGroup, need);
      runTrimWith(optionGroup, optionDistance, optionNewbarbs, need);
    });
  }

  // -------------------------
  // Run Trim
  // -------------------------
  function runTrimWith(group, distance, newbarbs, need){
    $('.optionsContent').html(UI.Throbber[0].outerHTML + '<br><br>');
    getData(group, newbarbs, true, true).then(function (data) {
      Dialog.close();
      var trim = createTrimList(distance, data, need);

      $('.farmGodContent').remove();
      $('#am_widget_Farm').first().before(buildTrimTable(trim, need));
      bindEventHandlers();
      lastPrefillNeed = need;
    });
  }

  // -------------------------
  // Build planning table (unchanged)
  // -------------------------
  function buildTable(plan){
    var html = '\
      <div class="farmGodContent">\
        <div id="FarmGodProgessbar" class="progress-bar" data-current="0" data-max="0" style="margin-bottom:6px"></div>\
        <table class="vis">\
          <thead>\
            <tr>\
              <th>'+t.table.origin+'</th>\
              <th>'+t.table.target+'</th>\
              <th>'+t.table.fields+'</th>\
              <th>'+t.table.farm+'</th>\
            </tr>\
          </thead>\
          <tbody>\
    ';

    if (!$.isEmptyObject(plan)) {
      for (var prop in plan) {
        plan[prop].forEach(function (val) {
          html += '\
            <tr class="farmRow">\
              <td>'+val.origin.name+' ('+val.origin.coord+')</td>\
              <td>'+val.target.coord+'</td>\
              <td>'+val.fields.toFixed(2)+'</td>\
              <td>\
                <a href="#" class="farmGod_icon"\
                   data-origin="'+val.origin.id+'"\
                   data-target="'+val.target.id+'"\
                   data-template="'+val.template.id+'">Send '+val.template.name.toUpperCase()+'</a>\
                &nbsp; | &nbsp;\
                <a href="'+game_data.link_base_pure+'info_village&id='+val.origin.id+'" target="_blank">'+t.table.goTo+' '+val.origin.name+'</a>\
                &nbsp; | &nbsp;\
                <a href="'+game_data.link_base_pure+'info_village&id='+val.target.id+'" target="_blank">'+t.table.goTo+' '+val.target.coord+'</a>\
                &nbsp; | &nbsp;\
                <a href="#" class="switchVillage" data-id="'+val.origin.id+'">Switch</a>\
              </td>\
            </tr>\
          ';
        });
      }
    } else {
      html += '<tr><td colspan="4" class="center">'+t.table.noFarmsPlanned+'</td></tr>';
    }

    html += '\
          </tbody>\
        </table>\
      </div>\
    ';
    return html;
  }

  // -------------------------
  // Trim (strict availability + de-duplication)
  // -------------------------
  function originHasNeed(pool, need){
    function ge(u){ return (pool[u] || 0) >= (need[u] || 0); }
    return ge('ram') && ge('light') && ge('axe') && ge('catapult') && ge('spy');
  }

  function createTrimList(optionDistance, data, need) {
    // 1) Collect the BEST (closest) origin per target only (dedupe across all origins)
    var bestByTarget = {}; // tCoord -> {fields, color, targetId, originCoord, originId, originName}

    for (var oCoord in data.villages) {
      var origin = data.villages[oCoord];
      if (!originHasNeed(origin.pool || {}, need)) continue; // origin must have the units at all

      for (var tCoord in data.farms.farms) {
        var info = data.farms.farms[tCoord];
        if (!info || !info.color) continue;
        if (info.color !== 'yellow' && info.color !== 'red') continue;

        var dist = lib.getDistance(oCoord, tCoord);
        if (dist > optionDistance) continue;

        var prev = bestByTarget[tCoord];
        if (!prev || dist < prev.fields) {
          bestByTarget[tCoord] = {
            fields: dist,
            color: info.color,
            targetId: info.id,
            originCoord: oCoord,
            originId: origin.id,
            originName: origin.name
          };
        }
      }
    }

    // 2) Group back by origin so the UI stays the same, but each target appears once globally
    var out = {};
    Object.keys(bestByTarget).forEach(function (tCoord) {
      var b = bestByTarget[tCoord];
      if (!out[b.originCoord]) out[b.originCoord] = [];
      out[b.originCoord].push({
        origin: { id: b.originId, name: b.originName, coord: b.originCoord },
        target: { coord: tCoord, id: b.targetId },
        fields: b.fields,
        color: b.color
      });
    });

    // 3) Sort each origin bucket by distance asc for nice processing order
    for (var oc in out) {
      out[oc].sort(function (a, b) { return a.fields - b.fields; });
    }

    return out;
  }

  function buildTrimTable(trim, need) {
    var acDelay = parseInt(localStorage.getItem('fg_autoclose_delay'),10);
    if (!isFinite(acDelay)) acDelay = DEF_CLOSE_DELAY;
    acDelay = Math.min(2000, Math.max(200, acDelay));
    var acTryRaw = localStorage.getItem('fg_autoclose_tryload');
    var acTry = (acTryRaw === null) ? true : (acTryRaw === '1' || acTryRaw === 'true');

    var html = '\
      <style>\
        .fg-topbar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:8px; padding:8px; border:1px solid #ccc; border-radius:8px; background:#f8f8f8; }\
        .fg-topbar .fg-row { display:flex; align-items:center; gap:6px; }\
        .fg-topbar input[type="range"]{ width:140px; }\
        .fg-badge { display:inline-block; min-width:28px; text-align:center; border:1px solid #999; padding:2px 6px; border-radius:3px; background:#fff; }\
      </style>\
      <div class="farmGodContent">\
        <h3>Trim (Yellow/Red within distance)</h3>\
        <div class="fg-topbar">\
          <div class="fg-row"><strong>Prefill:</strong></div>\
          <div class="fg-row">Rams <input id="pf_rams" type="range" min="0" max="300" step="1" value="'+need.ram+'"> <input id="pf_rams_num" type="number" min="0" max="9999" value="'+need.ram+'" style="width:56px;text-align:center"><span id="pf_rams_badge" class="fg-badge">'+need.ram+'</span></div>\
          <div class="fg-row">Light <input id="pf_light" type="range" min="0" max="300" step="1" value="'+need.light+'"> <input id="pf_light_num" type="number" min="0" max="9999" value="'+need.light+'" style="width:56px;text-align:center"><span id="pf_light_badge" class="fg-badge">'+need.light+'</span></div>\
          <div class="fg-row">Axe <input id="pf_axe" type="range" min="0" max="300" step="1" value="'+need.axe+'"> <input id="pf_axe_num" type="number" min="0" max="9999" value="'+need.axe+'" style="width:56px;text-align:center"><span id="pf_axe_badge" class="fg-badge">'+need.axe+'</span></div>\
          <div class="fg-row">Catapult <input id="pf_catapult" type="range" min="0" max="300" step="1" value="'+need.catapult+'"> <input id="pf_catapult_num" type="number" min="0" max="9999" value="'+need.catapult+'" style="width:56px;text-align:center"><span id="pf_catapult_badge" class="fg-badge">'+need.catapult+'</span></div>\
          <div class="fg-row">Scout <input id="pf_scout" type="range" min="0" max="300" step="1" value="'+need.spy+'"> <input id="pf_scout_num" type="number" min="0" max="9999" value="'+need.spy+'" style="width:56px;text-align:center"><span id="pf_scout_badge" class="fg-badge">'+need.spy+'</span></div>\
          <div class="fg-row">Auto-close <input id="pf_delay_ms" type="number" min="200" max="2000" step="50" value="'+acDelay+'" style="width:80px;text-align:center"> ms</div>\
          <div class="fg-row"><label><input id="pf_tryload" type="checkbox" '+(acTry?'checked':'')+'> Close on next load first</label></div>\
          <button class="btn rebuildTrim">Rebuild with these numbers</button>\
          <small style="opacity:.7">Changing prefill won’t refilter automatically.</small>\
        </div>\
        <table class="vis">\
          <thead>\
            <tr>\
              <th>'+t.table.origin+'</th>\
              <th>'+t.table.target+'</th>\
              <th>'+t.table.fields+'</th>\
              <th>Color</th>\
              <th>'+t.table.goTo+'</th>\
              <th>Rally</th>\
            </tr>\
          </thead>\
          <tbody>\
    ';

    var rows = 0;
    for (var prop in trim) {
      trim[prop].forEach(function(val){
        var originInfo = game_data.link_base_pure+'info_village&id='+val.origin.id;
        var targetInfo = game_data.link_base_pure+'info_village&id='+val.target.id;

        html += '\
          <tr class="farmRow">\
            <td>'+val.origin.name+' ('+val.origin.coord+')</td>\
            <td>'+val.target.coord+'</td>\
            <td>'+val.fields.toFixed(2)+'</td>\
            <td>'+val.color.toUpperCase()+'</td>\
            <td>\
              <a href="'+originInfo+'" target="_blank">'+t.table.goTo+' '+val.origin.name+'</a> | \
              <a href="'+targetInfo+'" target="_blank">'+t.table.goTo+' '+val.target.coord+'</a>\
            </td>\
            <td>\
              <a href="#" class="rally_fill"\
                 data-origin="'+val.origin.id+'"\
                 data-target-coord="'+val.target.coord+'">Rally (<span class="curRams">'+need.ram+'</span>R/<span class="curLight">'+need.light+'</span>LC/<span class="curAxe">'+need.axe+'</span>AX/<span class="curCatapult">'+need.catapult+'</span>CT/<span class="curScout">'+need.spy+'</span>SC)</a>\
            </td>\
          </tr>\
        ';
        rows++;
      });
    }

    if (!rows) {
      html += '<tr><td colspan="6" class="center">'+t.table.noFarmsPlanned+'</td></tr>';
    }

    html += '\
          </tbody>\
        </table>\
      </div>\
    ';
    return html;
  }

  // -------------------------
  // Data collection (regex fix included)
  // -------------------------
  function getData(group, newbarbs, losses, noFilter) {
    if (typeof noFilter === 'undefined') noFilter = false;
    var data = { villages: {}, commands: {}, farms: { templates: {}, farms: {} } };

    var villagesProcessor = function ($html) {
      var skipUnits = ['ram', 'catapult', 'snob', 'militia'];
      $html.find('#combined_table').find('.row_a, .row_b').filter(function (i, el) {
        return $(el).find('.bonus_icon_33').length == 0;
      }).map(function (i, el) {
        var $el = $(el);
        var $qel = $el.find('.quickedit-label').first();

        var pool = {};
        if ($('#mobileHeader').length) {
          game_data.units.forEach(function (unit) {
            var $cell = $el.find('img[src*="unit/unit_' + unit + '"]').closest('td');
            var val = $cell.length ? $cell.text().replace(/\D+/g,'').toNumber() : 0;
            pool[unit] = val;
          });
        } else {
          var units = game_data.units.slice();
          $el.find('.unit-item').each(function (idx, element) {
            var u = units[idx];
            var val = $(element).text().toNumber();
            pool[u] = val;
          });
        }

        var legacyUnits = [];
        if ($('#mobileHeader').length) {
          game_data.units.forEach(function (unit) {
            if (skipUnits.indexOf(unit) == -1) {
              var $img = $el.find('img[src*="unit/unit_' + unit + '"]');
              legacyUnits.push(($img.length) ? $img.closest('tr').text().trim().toNumber() : 0);
            }
          });
        } else {
          legacyUnits = $el.find('.unit-item').filter(function (index, element) {
            return skipUnits.indexOf(game_data.units[index]) == -1;
          }).map(function (index, element) {
            return $(element).text().toNumber();
          }).get();
        }

        data.villages[$qel.text().toCoord()] = {
          'name': $qel.data('text'),
          'id': parseInt($el.find('.quickedit-vn').first().data('id'), 10),
          'pool': pool,
          'units': legacyUnits
        };
      });
      return data;
    };

    var commandsProcessor = function ($html) {
      $html.find('#commands_table').find('.row_a, .row_ax, .row_b, .row_bx').map(function (i, el) {
        var $el = $(el);
        var coord = $el.find('.quickedit-label').first().text().toCoord();
        if (coord) {
          if (!data.commands.hasOwnProperty(coord)) data.commands[coord] = [];
          data.commands[coord].push(Math.round(lib.timestampFromString($el.find('td').eq(2).text().trim()) / 1000));
        }
      });
      return data;
    };

    var farmProcessor = function ($html) {
      if ($.isEmptyObject(data.farms.templates)) {
        var unitSpeeds = lib.getUnitSpeeds();
        $html.find('form[action*="action=edit_all"]').find('input[type="hidden"][name*="template"]').closest('tr').map(function (i, el) {
          var $el = $(el);
          data.farms.templates[$el.prev('tr').find('a.farm_icon').first().attr('class').match(/farm_icon_(.*)\s/)[1]] = {
            'id': $el.find('input[type="hidden"][name*="template"][name*="[id]"]').first().val().toNumber(),
            'units': $el.find('input[type="text"], input[type="number"]').map(function (index, element) { return $(element).val().toNumber(); }).get(),
            'speed': Math.max.apply(null, $el.find('input[type="text"], input[type="number"]').map(function (index, element) {
              return ($(element).val().toNumber() > 0) ? unitSpeeds[$(element).attr('name').trim().split('[')[0]] : 0;
            }).get())
          };
        });
      }
      $html.find('#plunder_list').find('tr[id^="village_"]').map(function (i, el) {
        var $el = $(el);
        data.farms.farms[$el.find('a[href*="screen=report&mode=all&view="]').first().text().toCoord()] = {
          'id': $el.attr('id').split('_')[1].toNumber(),
          'color': $el.find('img[src*="graphic/dots/"]').attr('src').match(/dots\/(green|yellow|red|blue|red_blue)/)[1],
          'max_loot': $el.find('img[src*="max_loot/1"]').length > 0
        };
      });
      return data;
    };

    var findNewbarbs = function () {
      if (newbarbs) {
        return twLib.get('/map/village.txt').then(function (allVillages) {
          var lines = allVillages.match(/[^\r\n]+/g) || [];
          lines.forEach(function (villageData) {
            var parts = villageData.split(',');
            var id = parts[0], x = parts[2], y = parts[3], player_id = parts[4];
            var coord = x + '|' + y;
            if (player_id == 0 && !data.farms.farms.hasOwnProperty(coord)) {
              data.farms.farms[coord] = { 'id': id.toNumber() };
            }
          });
          return data;
        });
      } else { return data; }
    };

    var filterFarms = function () {
      data.farms.farms = Object.fromEntries(Object.entries(data.farms.farms).filter(function(pair){
        var val = pair[1];
        return (!val.hasOwnProperty('color')) || ((val.color != 'red') && (val.color != 'red_blue') && (val.color != 'yellow' || losses));
      }));
      return data;
    };

    return Promise.all([
      lib.processAllPages(TribalWars.buildURL('GET', 'overview_villages', { 'mode': 'combined', 'group': group }), villagesProcessor),
      lib.processAllPages(TribalWars.buildURL('GET', 'overview_villages', { 'mode': 'commands', 'type': 'attack' }), commandsProcessor),
      lib.processAllPages(TribalWars.buildURL('GET', 'am_farm'), farmProcessor),
      findNewbarbs()
    ]).then(function(){ return noFilter ? data : filterFarms(); }).then(function(){ return data; });
  }

  // -------------------------
  // Planning (unchanged)
  // -------------------------
  function createPlanning(optionDistance, optionTime, optionMaxloot, data) {
    var plan = { counter: 0, farms: {} };
    var serverTime = Math.round(lib.getCurrentServerTime() / 1000);

    for (var prop in data.villages) {
      var orderedFarms = Object.keys(data.farms.farms).map(function (key) {
        return { 'coord': key, 'dis': lib.getDistance(prop, key) };
      }).sort(function (a, b) { return (a.dis > b.dis) ? 1 : -1; });

      orderedFarms.forEach(function (el) {
        var farmIndex = data.farms.farms[el.coord];
        var template_name = (optionMaxloot && farmIndex.hasOwnProperty('max_loot') && farmIndex.max_loot) ? 'b' : 'a';
        var template = data.farms.templates[template_name];

        var unitsLeft = lib.subtractArrays(data.villages[prop].units, template.units);
        var distance = lib.getDistance(prop, el.coord);
        var arrival = Math.round(serverTime + ((distance * template.speed) * 60) + Math.round(plan.counter / 5));
        var maxTimeDiff = Math.round(optionTime * 60);
        var timeDiff = true;

        if (data.commands.hasOwnProperty(el.coord)) {
          if (!farmIndex.hasOwnProperty('color') && data.commands[el.coord].length > 0) timeDiff = false;
          data.commands[el.coord].forEach(function (timestamp) { if (Math.abs(timestamp - arrival) < maxTimeDiff) timeDiff = false; });
        } else {
          data.commands[el.coord] = [];
        }

        if (unitsLeft && timeDiff && (distance < optionDistance)) {
          plan.counter++;
          if (!plan.farms.hasOwnProperty(prop)) plan.farms[prop] = [];
          plan.farms[prop].push({
            'origin': { 'coord': prop, 'name': data.villages[prop].name, 'id': data.villages[prop].id },
            'target': { 'coord': el.coord, 'id': farmIndex.id },
            'fields': distance,
            'template': { 'name': template_name, 'id': template.id }
          });
          data.villages[prop].units = unitsLeft;
          data.commands[el.coord].push(arrival);
        }
      });
    }
    return plan;
  }

  // -------------------------
  // Event bindings (Enter + Rally + Prefill sliders + UI autoclose)
  // -------------------------
  function bindEventHandlers() {
    // Accountmanager A/B
    $('.farmGod_icon').off('click').on('click', function () {
      if (game_data.market != 'nl' || $(this).data('origin') == curVillage) {
        sendFarm($(this));
      } else {
        UI.ErrorMessage(t.messages.villageError);
      }
    });

    // ENTER → open first Rally (remove row only if window opens)
    $(document).off('keydown.fgenter').on('keydown.fgenter', function (event) {
      var key = (event.keyCode || event.which);
      if (key == 13) {
        var $firstRally = $('.rally_fill').first();
        if ($firstRally.length) {
          event.preventDefault();
          var originId = $firstRally.data('origin');
          var targetCoord = String($firstRally.data('target-coord'));

          var need = {
            ram: parseInt($('#pf_rams').val(),10) || 0,
            light: parseInt($('#pf_light').val(),10) || 0,
            axe: parseInt($('#pf_axe').val(),10) || 0,
            catapult: parseInt($('#pf_catapult').val(),10) || 0,
            spy: parseInt($('#pf_scout').val(),10) || 0
          };
          lastPrefillNeed = need;

          var ac = getAutoCloseSettings();
          var ok = openRally(originId, targetCoord, need, ac);
          if (ok) { $firstRally.closest('tr').remove(); }
          return;
        }
        // fallback
        $('.farmGod_icon').first().trigger('click');
      }
    });

    // Switch current village
    $('.switchVillage').off('click').on('click', function () {
      curVillage = $(this).data('id');
      UI.SuccessMessage(t.messages.villageChanged);
      $(this).closest('tr').remove();
    });

    function syncPF(id){
      $('#'+id).on('input', function(){ $('#'+id+'_num').val(this.value); $('#'+id+'_badge').text(this.value); refreshRallyBadges(); });
      $('#'+id+'_num').on('input', function(){ $('#'+id).val(this.value); $('#'+id+'_badge').text(this.value); refreshRallyBadges(); });
    }
    function refreshRallyBadges(){
      var r = parseInt($('#pf_rams').val(),10) || 0;
      var l = parseInt($('#pf_light').val(),10) || 0;
      var ax= parseInt($('#pf_axe').val(),10) || 0;
      var ca= parseInt($('#pf_catapult').val(),10) || 0;
      var sc= parseInt($('#pf_scout').val(),10) || 0;
      $('.rally_fill .curRams').text(r);
      $('.rally_fill .curLight').text(l);
      $('.rally_fill .curAxe').text(ax);
      $('.rally_fill .curCatapult').text(ca);
      $('.rally_fill .curScout').text(sc);
    }
    syncPF('pf_rams'); syncPF('pf_light'); syncPF('pf_axe'); syncPF('pf_catapult'); syncPF('pf_scout');

    // Auto-close controls wiring
    function clampDelay(v){ v = parseInt(v,10); if(!isFinite(v)) v = DEF_CLOSE_DELAY; return Math.min(2000, Math.max(200, v)); }
    function getAutoCloseSettings(){
      var v = clampDelay($('#pf_delay_ms').val());
      var t = $('#pf_tryload').prop('checked') !== false;
      return { delayMs: v, tryLoadFirst: t };
    }
    $('#pf_delay_ms').off('input change').on('input change', function(){ var v = clampDelay(this.value); this.value = v; localStorage.setItem('fg_autoclose_delay', String(v)); });
    $('#pf_tryload').off('change').on('change', function(){ localStorage.setItem('fg_autoclose_tryload', this.checked ? '1' : '0'); });

    // Rebuild Trim with current prefill
    $('.rebuildTrim').off('click').on('click', function(){
      var options = JSON.parse(localStorage.getItem('farmGod_options') || '{}');
      var group = options.optionGroup || 0;
      var distance = options.optionDistance || 25;
      var need = {
        ram: parseInt($('#pf_rams').val(),10) || 0,
        light: parseInt($('#pf_light').val(),10) || 0,
        axe: parseInt($('#pf_axe').val(),10) || 0,
        catapult: parseInt($('#pf_catapult').val(),10) || 0,
        spy: parseInt($('#pf_scout').val(),10) || 0
      };
      if (!isValidNeed(need)){ UI.ErrorMessage('Set at least one unit > 0'); return; }
      saveNeed(group, need);
      runTrimWith(group, distance, (options.optionNewbarbs||false), need);
    });

    // Mouse click Rally
    $('.rally_fill').off('click').on('click', function (e) {
      e.preventDefault();
      var originId    = $(this).data('origin');
      var targetCoord = String($(this).data('target-coord'));
      var need = {
        ram: parseInt($('#pf_rams').val(),10) || 0,
        light: parseInt($('#pf_light').val(),10) || 0,
        axe: parseInt($('#pf_axe').val(),10) || 0,
        catapult: parseInt($('#pf_catapult').val(),10) || 0,
        spy: parseInt($('#pf_scout').val(),10) || 0
      };
      lastPrefillNeed = need;
      var ac = getAutoCloseSettings();
      openRally(originId, targetCoord, need, ac);
    });
  }

  // -------------------------
  // Send farm (Accountmanager)
  // -------------------------
  function sendFarm($this) {
    var n = Timing.getElapsedTimeSinceLoad();
    if (!farmBusy && !(Accountmanager.farm.last_click && n - Accountmanager.farm.last_click < 200)) {
      farmBusy = true; Accountmanager.farm.last_click = n;

      var $pb = $('#FarmGodProgessbar');
      TribalWars.post(
        Accountmanager.send_units_link.replace(/village=(\d+)/, 'village=' + $this.data('origin')),
        null,
        { target: $this.data('target'), template_id: $this.data('template'), source: $this.data('origin') },
        function (r) {
          UI.SuccessMessage(r.success);
          $pb.data('current', $pb.data('current') + 1);
          UI.updateProgressBar($pb, $pb.data('current'), $pb.data('max'));
          $this.closest('.farmRow').remove();
          farmBusy = false;
        },
        function (r) {
          UI.ErrorMessage(r || t.messages.sendError);
          $pb.data('current', $pb.data('current') + 1);
          UI.updateProgressBar($pb, $pb.data('current'), $pb.data('max'));
          $this.closest('.farmRow').remove();
          farmBusy = false;
        }
      );
    }
  }

  return { init: init };
})(window.FarmGod.Library, window.FarmGod.Translation);

// boot
(function(){ window.FarmGod.Main.init(); })();
/* FarmGod – Trim V3 — Part 3/3 (New Barbs Add‑On) — clean v2
 * by Vasia & Siolinio & Ethical Hacker GPT
 *
 * This file is a SAFE rewrite of Part 3 with stricter syntax (no stray parens),
 * same features as before + the Trim loader typewriter + Trim table polish.
 * It is designed to coexist; it checks for existing hooks before attaching.
 */

(function(NewBarbs){
  'use strict';

  // ---- Guards ----
  if (!window.FarmGod || !window.FarmGod.Library) {
    console.warn('FarmGod Library missing — load Part 1/2 first');
    return;
  }
  var lib = window.FarmGod.Library;

  // ---- Small utils ----
  function clamp(n, min, max){ n = parseInt(n,10); if(!isFinite(n)) n=min; return Math.max(min, Math.min(max, n)); }
  function toNumber(x){ var v = parseFloat(x); return isFinite(v)?v:0; }
  function coordOf(str){ var m=(String(str).match(/\d{1,3}\|\d{1,3}/)||[null])[0]; return m||null; }
  function poolSatisfies(pool, needByName){ for (var u in needByName){ if(!needByName.hasOwnProperty(u)) continue; var req=needByName[u]||0; if(req>0 && (pool[u]||0) < req) return false; } return true; }

  // =====================================================
  // Options enhancements (button + credits + defaults + UI)
  // =====================================================
  function enhanceOptionsUI(){
    try {
      var $opt = $('.optionsContent');
      if (!$opt.length) return;

      // Add New Barbs button next to Trim
      var $trim = $opt.find('.trimButton');
      if ($trim.length && !$opt.find('.newbarbsButton').length){
        $('<button class="newbarbsButton btn" style="margin-left:8px">Add new barbs</button>')
          .insertAfter($trim)
          .on('mousedown.fgflag', function(){ window.FarmGod.__lastAction = 'newbarbs'; })
          .on('click', function(){
            var opts = JSON.parse(localStorage.getItem('farmGod_options')||'{}');
            var group = parseInt(opts.optionGroup||0,10);
            var distance = parseFloat(opts.optionDistance||25);
            $('.optionsContent').html(UI.Throbber[0].outerHTML + '<br><br>');
            runNewBarbsWith(group, distance);
          });
      }
      // mark Trim action for loader
      $opt.find('.trimButton').off('mousedown.fgflag').on('mousedown.fgflag', function(){ window.FarmGod.__lastAction = 'trim'; });

      // Hide checkboxes + Plan farms (non-destructive)
      $opt.find('.optionLosses').closest('label').hide();
      $opt.find('.optionMaxloot').closest('label').hide();
      $opt.find('.optionNewbarbs').closest('label').hide();
      $opt.find('.optionButton').hide();

      // Credits bottom-right
      if (!$opt.find('.fg-credit').length){
        var $cr = $('<div></div>').addClass('fg-credit').css({ textAlign:'right', marginTop:'6px', opacity:0.75 }).text('By Siolinio');
        $opt.append($cr);
      }

      // Default Group: All (value=0 or text=all) — set once
      var $sel = $opt.find('.optionGroup');
      if ($sel.length && !$sel.data('fg_set_all')){
        var selected=false;
        if ($sel.find('option[value="0"]').length){ $sel.val('0'); selected=true; }
        else {
          var $al = $sel.find('option').filter(function(){ return $(this).text().trim().toLowerCase()==='all'; }).first();
          if ($al.length){ $sel.val($al.val()); selected=true; }
        }
        if (selected){
          $sel.data('fg_set_all',1);
          try {
            var st = JSON.parse(localStorage.getItem('farmGod_options')||'{}');
            st.optionGroup = parseInt($sel.val(),10) || 0;
            localStorage.setItem('farmGod_options', JSON.stringify(st));
          } catch(_){ /* ignore */ }
        }
      }

      // Loader typewriter for Trim
      if (window.FarmGod && window.FarmGod.__lastAction === 'trim'){
        if (!$opt.find('.fg-typing').length){
          var $wrap = $('<div class="fg-typing"></div>').css({ display:'flex', alignItems:'center', gap:'10px', padding:'6px 2px' });
          // keep spinner if present
          if (window.UI && UI.Throbber && UI.Throbber.length){
            var $spin = $(UI.Throbber[0].outerHTML);
            $wrap.append($spin);
          }
          var $type = $('<span class="fg-type"></span>').css({ fontFamily:'monospace', whiteSpace:'pre', lineHeight:1.4 });
          $wrap.append($type);
          $opt.append($wrap);
          (function(){ var i=0; var msg=' Siolinio did it again........'; var tm=setInterval(function(){ $type.text(msg.slice(0, ++i)); if(i>=msg.length) clearInterval(tm); }, 60); })();
        }
      }
    } catch(e){ /* keep silent */ }
  }

  // Observe DOM to enhance options and polish Trim table when they appear
  function safeObserver(cb){
    try { var mo = new MutationObserver(function(){ cb(); }); mo.observe(document.body, { childList:true, subtree:true }); return mo; }
    catch(_){ setInterval(cb, 500); return null; }
  }

  // =====================================================
  // Trim table polish (colored dot + clickable Origin/Target)
  // =====================================================
  function polishTrimTable(){
    try {
      var $wraps = $('.farmGodContent'); if(!$wraps.length) return;
      $wraps.each(function(){
        var $box=$(this); var $h=$box.find('> h3').first(); if(!$h.length) return;
        if ($h.text().indexOf('Trim')===-1) return;
        var $table = $box.find('table.vis').first(); if(!$table.length || $table.data('fgPolished')) return;
        // locate Go to column index
        var goToIdx=-1; $table.find('thead th').each(function(idx){ if ($(this).text().trim().toLowerCase()==='go to'){ goToIdx=idx; }});
        if (goToIdx>-1){ $table.find('thead th').eq(goToIdx).remove(); }
        $table.find('tbody tr').each(function(){
          var $tr=$(this); var $td=$tr.children('td'); if(!$td.length) return;
          if (goToIdx===-1 || $td.length<=goToIdx) return;
          var $origin=$td.eq(0), $target=$td.eq(1), $color=$td.eq(3), $goto=$td.eq(goToIdx);
          var $links=$goto.find('a'); var originHref=$links.eq(0).attr('href'); var targetHref=$links.eq(1).attr('href');
          if (originHref){ var originText=$origin.text(); $origin.empty().append($('<a></a>').attr({ href: originHref, target:'_blank' }).text(originText)); }
          if (targetHref){ var targetText=$target.text(); $target.empty().append($('<a></a>').attr({ href: targetHref, target:'_blank' }).text(targetText)); }
          var colorTxt=$.trim($color.text()).toLowerCase(); var col=(colorTxt.indexOf('red')!==-1)?'#e00000':'#ffcb00';
          $color.empty().append($('<span></span>').attr('title', colorTxt.toUpperCase()).css({ display:'inline-block', width:'10px', height:'10px', borderRadius:'50%', background: col }));
          $goto.remove();
        });
        $table.data('fgPolished',1);
      });
    } catch(e){ /* quiet */ }
  }

  // =====================================================
  // New Barbs core (data + render + actions)
  // =====================================================
  function fetchVillagesAndPools(group){
    var url = TribalWars.buildURL('GET', 'overview_villages', { 'mode':'combined', 'group': group });
    var data = {};
    function parse($html){
      $html.find('#combined_table').find('.row_a, .row_b').filter(function(){ return $(this).find('.bonus_icon_33').length==0; }).each(function(){
        var $el=$(this); var $q=$el.find('.quickedit-label').first(); var coord=coordOf($q.text()); if(!coord) return;
        var pool={};
        if ($('#mobileHeader').length){
          for (var i=0;i<game_data.units.length;i++){ var u=game_data.units[i]; var $cell=$el.find('img[src*="unit/unit_'+u+'"]').closest('td'); var txt=$cell.length?$cell.text().replace(/\D+/g,''):'0'; pool[u]=toNumber(txt); }
        } else {
          var units = game_data.units.slice();
          $el.find('.unit-item').each(function(i,td){ pool[units[i]] = toNumber($(td).text()); });
        }
        data[coord] = { id: parseInt($el.find('.quickedit-vn').first().data('id'),10), name: $q.data('text'), pool: pool };
      });
    }
    return lib.processAllPages(url, parse).then(function(){ return data; });
  }

  function fetchCommands(){
    var url = TribalWars.buildURL('GET', 'overview_villages', { 'mode':'commands', 'type':'attack' });
    var cmds = {};
    function parse($html){
      $html.find('#commands_table').find('.row_a, .row_ax, .row_b, .row_bx').each(function(){
        var c = coordOf($(this).find('.quickedit-label').first().text()); if(c) cmds[c]=true;
      });
    }
    return lib.processAllPages(url, parse).then(function(){ return cmds; });
  }

  function fetchPlunderCoords(){
    var url = TribalWars.buildURL('GET', 'am_farm');
    var set = {}; var templates = {};
    function parse($html){
      $html.find('#plunder_list').find('tr[id^="village_"]').each(function(){ var coord = coordOf($(this).find('a[href*="screen=report&mode=all&view="]').first().text()); if(coord) set[coord]=true; });
      $html.find('form[action*="action=edit_all"]').find('input[type="hidden"][name*="template"]').closest('tr').each(function(){
        var $row=$(this); var cls=$row.prev('tr').find('a.farm_icon').first().attr('class')||''; var m=cls.match(/farm_icon_(.*)\s/); if(!m) return; var key=m[1];
        var inputs=$row.find('input[type="text"], input[type="number"]');
        var unitsByName={}; inputs.each(function(){ var nm=$(this).attr('name'); if(!nm) return; var uname=nm.trim().split('[')[0]; unitsByName[uname]=toNumber($(this).val()); });
        var id = toNumber($row.find('input[type="hidden"][name*="template"][name*="[id]"]').first().val());
        templates[key] = { id:id, unitsByName:unitsByName };
      });
    }
    return lib.processAllPages(url, parse).then(function(){ return { set:set, templates:templates }; });
  }

  function fetchNewBarbCoords(){
    return twLib.get('/map/village.txt').then(function(txt){
      var lines = String(txt).match(/[^\r\n]+/g)||[]; var arr=[];
      for (var i=0;i<lines.length;i++){
        var p=lines[i].split(','); var id=p[0], x=p[2], y=p[3], player=p[4]; if (player==0){ arr.push({ coord: x+'|'+y, id: toNumber(id) }); }
      }
      return arr;
    });
  }

  function chooseTemplate(templates){
    if (templates['b']) return { key:'b', tpl:templates['b'] };
    if (templates['a']) return { key:'a', tpl:templates['a'] };
    return null;
  }

  function runNewBarbsWith(group, maxDist){
    Promise.all([
      fetchVillagesAndPools(group),
      fetchCommands(),
      fetchPlunderCoords(),
      fetchNewBarbCoords()
    ]).then(function(res){
      var villages = res[0], commands = res[1], pc = res[2], newBarbs = res[3];
      var present = pc.set, templates = pc.templates; var pick = chooseTemplate(templates);
      if (!pick){ UI.ErrorMessage('Farm Assistant templates not found'); Dialog.close(); return; }
      var needByName = pick.tpl.unitsByName || {}; var tplId = pick.tpl.id; var tplLetter = pick.key.toUpperCase();

      // Only barbs not already on plunder
      var candidates = [];
      for (var i=0;i<newBarbs.length;i++){ var v=newBarbs[i]; if (!present[v.coord]) candidates.push(v); }

      // For each target, pick closest origin with availability and no existing command
      var best = {}; // tCoord -> {fields, origin...}
      for (var j=0;j<candidates.length;j++){
        var t=candidates[j]; if (commands[t.coord]) continue;
        for (var oCoord in villages){
          var origin = villages[oCoord];
          if (!poolSatisfies(origin.pool||{}, needByName)) continue;
          var dist = lib.getDistance(oCoord, t.coord);
          if (dist > maxDist) continue;
          var prev = best[t.coord];
          if (!prev || dist < prev.fields){ best[t.coord] = { fields: dist, targetId: t.id, originCoord:oCoord, originId:origin.id, originName:origin.name }; }
        }
      }

      var out={};
      for (var tc in best){ if(!best.hasOwnProperty(tc)) continue; var b=best[tc]; if(!out[b.originCoord]) out[b.originCoord]=[]; out[b.originCoord].push({ origin:{id:b.originId,name:b.originName,coord:b.originCoord}, target:{coord:tc,id:b.targetId}, fields:b.fields }); }
      for (var oc in out){ if(!out.hasOwnProperty(oc)) continue; out[oc].sort(function(a,b){ return a.fields-b.fields; }); }

      Dialog.close();
      $('.farmGodContent').remove();
      $('#am_widget_Farm').first().before(buildNewBarbsTable(out, tplLetter, tplId));
      wireNewBarbsHandlers();
    });
  }

  function buildNewBarbsTable(list, tplLetter, tplId){
    var count=0; for (var oc in list){ if(!list.hasOwnProperty(oc)) continue; count += list[oc].length; }
    var htmlParts=[];
    htmlParts.push('<div class="farmGodContent">');
    htmlParts.push('<h3>New Barbs (map-only) — Sending with Template '+tplLetter+'</h3>');
    htmlParts.push('<div style="margin:6px 0 8px 0;opacity:.85">New barbs found: '+count+'</div>');
    htmlParts.push('<div style="margin-bottom:8px"><button class="btn rebuildNewBarbs">Rebuild New Barbs</button><small style="opacity:.7;margin-left:8px">Uses Farm Assistant Template '+tplLetter+' automatically.</small></div>');
    htmlParts.push('<table class="vis"><thead><tr><th>Origin</th><th>Target</th><th>fields</th><th>Color</th><th>Go to</th><th>Send</th></tr></thead><tbody>');
    var rows=0;
    for (var oc2 in list){ if(!list.hasOwnProperty(oc2)) continue; var arr=list[oc2]; for (var k=0;k<arr.length;k++){ var v=arr[k];
      var originInfo=game_data.link_base_pure+'info_village&id='+v.origin.id;
      var targetInfo=game_data.link_base_pure+'info_village&id='+v.target.id;
      htmlParts.push('<tr class="farmRow">');
      htmlParts.push('<td>'+v.origin.name+' ('+v.origin.coord+')</td>');
      htmlParts.push('<td>'+v.target.coord+'</td>');
      htmlParts.push('<td>'+v.fields.toFixed(2)+'</td>');
      htmlParts.push('<td>NEW</td>');
      htmlParts.push('<td><a href="'+originInfo+'" target="_blank">Go to '+v.origin.name+'</a> | <a href="'+targetInfo+'" target="_blank">Go to '+v.target.coord+'</a></td>');
      htmlParts.push('<td><a href="#" class="nb_send" data-origin="'+v.origin.id+'" data-target="'+v.target.id+'" data-template="'+tplId+'">Send '+tplLetter+'</a></td>');
      htmlParts.push('</tr>');
      rows++; }}
    if(!rows) htmlParts.push('<tr><td colspan="6" class="center">No new barbs within settings.</td></tr>');
    htmlParts.push('</tbody></table></div>');
    return htmlParts.join('');
  }

  function wireNewBarbsHandlers(){
    // ENTER (capture) -> first nb_send
    function onKeyDownCapture(ev){ var code = ev.keyCode||ev.which; if(code!==13) return; var el = document.querySelector('.nb_send'); if (el){ ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); el.click(); } }
    try { document.removeEventListener('keydown', onKeyDownCapture, true); } catch(_){ }
    document.addEventListener('keydown', onKeyDownCapture, true);

    // Click send
    $('.nb_send').off('click').on('click', function(e){
      e.preventDefault();
      var $a=$(this);
      var origin=$a.data('origin'); var target=$a.data('target'); var tpl=$a.data('template');
      if (!origin || !target || !tpl){ UI.ErrorMessage('Missing template or ids'); return; }
      var url = Accountmanager.send_units_link.replace(/village=(\d+)/, 'village='+origin);
      TribalWars.post(url, null, { target: target, template_id: tpl, source: origin }, function(r){ UI.SuccessMessage(r && r.success ? r.success : 'Sent'); $a.closest('tr').remove(); }, function(err){ UI.ErrorMessage(err || 'Error: farm not sent!'); $a.closest('tr').remove(); });
    });

    // Rebuild
    $('.rebuildNewBarbs').off('click').on('click', function(){ var opts = JSON.parse(localStorage.getItem('farmGod_options')||'{}'); runNewBarbsWith(parseInt(opts.optionGroup||0,10), parseFloat(opts.optionDistance||25)); });
  }

  // ---- Bootstrap observers once ----
  if (!window.FarmGod.__nb_obs){ window.FarmGod.__nb_obs = true; safeObserver(function(){ enhanceOptionsUI(); polishTrimTable(); }); }

  // expose (optional)
  NewBarbs.run = runNewBarbsWith;

})(window.FarmGod.NewBarbs = window.FarmGod.NewBarbs || {});


// === Additions: New Barbs typewriter loader + list polish (non-destructive) ===
(function(){
  'use strict';
  function getThIdx($table, name){
    var idx=-1; $table.find('thead th').each(function(i){ if ($(this).text().trim().toLowerCase()===name) idx=i; });
    return idx;
  }
  function polishNewBarbsTable(){
    var $wraps = $('.farmGodContent'); if(!$wraps.length) return;
    $wraps.each(function(){
      var $box=$(this); var $h=$box.find('> h3').first(); if(!$h.length) return;
      if ($h.text().toLowerCase().indexOf('new barbs')===-1) return;
      var $table = $box.find('table.vis').first(); if(!$table.length || $table.data('fgPolishedNB')) return;
      var idxOrigin=getThIdx($table,'origin');
      var idxTarget=getThIdx($table,'target');
      var idxFields=getThIdx($table,'fields'); // keep as-is
      var idxColor=getThIdx($table,'color');
      var idxGoTo=getThIdx($table,'go to');
      $table.find('tbody tr').each(function(){
        var $tr=$(this); var $td=$tr.children('td'); if(!$td.length) return;
        if (idxGoTo>=0 && $td.length>idxGoTo){
          var $goto=$td.eq(idxGoTo); var $links=$goto.find('a');
          var originHref=$links.eq(0).attr('href'); var targetHref=$links.eq(1).attr('href');
          if (idxOrigin>=0 && $td.length>idxOrigin && originHref){ var originText=$td.eq(idxOrigin).text(); $td.eq(idxOrigin).empty().append($('<a></a>').attr({href:originHref,target:'_blank'}).text(originText)); }
          if (idxTarget>=0 && $td.length>idxTarget && targetHref){ var targetText=$td.eq(idxTarget).text(); $td.eq(idxTarget).empty().append($('<a></a>').attr({href:targetHref,target:'_blank'}).text(targetText)); }
        }
        if (idxColor>=0 && $td.length>idxColor){ $td.eq(idxColor).empty().append($('<span></span>').attr('title','NEW').css({display:'inline-block',width:'10px',height:'10px',borderRadius:'50%',background:'#2f6fdb'})); }
        if (idxGoTo>=0 && $td.length>idxGoTo){ $td.eq(idxGoTo).remove(); }
      });
      if (idxGoTo>=0){ $table.find('thead th').eq(idxGoTo).remove(); }
      $table.data('fgPolishedNB',1);
    });
  }
  function typewriterForNewBarbsLoader(){
    var $opt=$('.optionsContent'); if(!$opt.length) return;
    if (!(window.FarmGod && window.FarmGod.__lastAction==='newbarbs')) return;
    if ($opt.find('.fg-typing').length) return;
    var htmlNow=String($opt.html()||'').toLowerCase();
    if (htmlNow.indexOf('throbber')===-1 && htmlNow.indexOf('<img')===-1) return;
    var $wrap=$('<div class="fg-typing"></div>').css({display:'flex',alignItems:'center',gap:'10px',padding:'6px 2px'});
    if (window.UI && UI.Throbber && UI.Throbber.length){ var $spin=$(UI.Throbber[0].outerHTML); $wrap.append($spin); }
    var $type=$('<span class="fg-type"></span>').css({fontFamily:'monospace',whiteSpace:'pre',lineHeight:1.4});
    $wrap.append($type); $opt.append($wrap);
    (function(){ var i=0,msg=' Siolinio did it again........'; var tm=setInterval(function(){ $type.text(msg.slice(0, ++i)); if(i>=msg.length) clearInterval(tm); },60); })();
  }
  try{ var mo2=new MutationObserver(function(){ polishNewBarbsTable(); typewriterForNewBarbsLoader(); }); mo2.observe(document.body,{childList:true,subtree:true}); }
  catch(_){ setInterval(function(){ polishNewBarbsTable(); typewriterForNewBarbsLoader(); },500); }
})();
/*
 * SiolFarm — inline UI rebrand & polish (drop‑in block)
 * Safe to append at the **end** of your existing SiolFarm.js from the repo.
 *
 * What it does (UI only):
 *  - Rebrand Options title → "SiolFarm Options"
 *  - Single‑column spacing & soft styling (padding/margins/rounded)
 *  - Default group selector to **All** (value 0 or option text "All"), persisted in farmGod_options
 *  - Optional header typewriter/progressive effect (non‑blocking)
 *
 * No changes to logic (Trim/New Barbs/Enter/AutoClose etc.).
 *
 * Configure visual effect with:  window.SF_EFFECTS = 'minimal' | 'typewriter' | 'progressive'
 * Default is 'typewriter'.
 */
(function(){
  'use strict';

  // ---- Config
  var EFFECT = (window.SF_EFFECTS || 'typewriter'); // 'minimal' | 'typewriter' | 'progressive'

  // ---- Helpers
  function ensureStyle(){
    if (document.querySelector('style.sf_ui_style')) return;
    var css = ''+
      '.optionsContent{max-width:780px}\n'+
      '.optionsContent>*{margin:10px 0!important}\n'+
      '.optionsContent h3{font-size:18px;margin-bottom:8px}\n'+
      '.optionsContent .vis, .optionsContent .fg-card, .optionsContent table.vis{border:1px solid #c8c0a8;border-radius:10px;background:#f7f3e7;padding:10px}\n'+
      '.optionsContent .fg-row{display:grid;grid-template-columns:140px 1fr 64px;align-items:center;gap:10px;margin:6px 0}\n'+
      '.optionsContent input[type="range"]{width:100%}\n'+
      '.optionsContent input[type="number"]{width:64px;text-align:center}\n'+
      '.optionsContent .btn, .optionsContent button{padding:6px 12px;border-radius:8px}\n'+
      '.optionsContent .trimButton{background:#d4a657;border:1px solid #a27b34;color:#1b1206}\n'+
      '.optionsContent .newbarbsButton{background:#6aa0e6;border:1px solid #3d6fb8;color:#0b1b2d}\n'+
      '.optionsContent .optionButton{background:#ddd;border:1px solid #aaa}\n'+
      '.optionsContent .sf-credit{text-align:right;font-size:12px;opacity:.75}\n'+
      '.optionsContent .sf-fade{opacity:0;transform:translateY(4px);transition:opacity .18s ease, transform .18s ease}\n'+
      '.optionsContent .sf-fade.sf-in{opacity:1;transform:none}\n';
    var tag = document.createElement('style');
    tag.className = 'sf_ui_style';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function typewriterTitle($h3, text){
    try {
      if (!$h3 || !$h3.length) return;
      var node = $h3[0];
      var i = 0; node.textContent = '';
      var tm = setInterval(function(){
        node.textContent = text.slice(0, ++i);
        if (i >= text.length) clearInterval(tm);
      }, 60);
    } catch(_){}
  }

  function progressiveReveal($opt){
    try{
      var kids = Array.prototype.slice.call($opt.children());
      for (var i=0;i<kids.length;i++){
        var el = kids[i];
        if (el.tagName && el.tagName.toLowerCase()==='h3') continue;
        el.classList.add('sf-fade');
        (function(e, idx){ setTimeout(function(){ e.classList.add('sf-in'); }, 120+idx*90); })(el, i);
      }
    }catch(_){}
  }

  function setGroupDefaultAll($sel){
    try {
      if (!$sel || !$sel.length) return;
      var changed = false;
      if ($sel.find('option[value="0"]').length){ $sel.val('0'); changed = true; }
      else {
        var opts = $sel.find('option');
        for (var i=0;i<opts.length;i++){
          var t = (opts[i].textContent||'').trim().toLowerCase();
          if (t === 'all'){ $sel.val(opts[i].value); changed = true; break; }
        }
      }
      if (changed){
        try{
          var st = JSON.parse(localStorage.getItem('farmGod_options')||'{}');
          st.optionGroup = parseInt($sel.val(),10) || 0;
          localStorage.setItem('farmGod_options', JSON.stringify(st));
        }catch(_){}
      }
    } catch(_){}
  }

  function applyOnce(){
    var $opt = window.jQuery ? window.jQuery('.optionsContent') : null;
    if (!$opt || !$opt.length) return;
    if ($opt.data('sf_ui_applied')) return;
    $opt.data('sf_ui_applied', 1);

    ensureStyle();

    // Rebrand title
    var $h3 = $opt.find('h3').first();
    if ($h3.length){
      var newTitle = 'SiolFarm Options';
      if (EFFECT === 'typewriter') typewriterTitle($h3, newTitle); else $h3.text(newTitle);
    }

    // Default group => All
    var $sel = $opt.find('.optionGroup');
    if ($sel.length) setGroupDefaultAll($sel);

    // Credits
    if (!$opt.find('.sf-credit').length){
      var div = document.createElement('div');
      div.className = 'sf-credit';
      div.textContent = 'By Siolinio';
      $opt[0].appendChild(div);
    }

    // Progressive (optional, non‑blocking)
    if (EFFECT === 'progressive') progressiveReveal($opt[0] ? window.jQuery($opt[0]) : $opt);
  }

  // ---- Bootstrap: run now and watch for dialog
  try { applyOnce(); } catch(_){}
  try {
    var mo = new MutationObserver(function(){ applyOnce(); });
    mo.observe(document.body, { childList:true, subtree:true });
  } catch(_) {
    setInterval(applyOnce, 400);
  }
})();
/*
 * SiolFarm — inline UI rebrand & polish (drop‑in block)
 * Safe to append at the **end** of your existing SiolFarm.js from the repo.
 *
 * What it does (UI only):
 *  - Rebrand Options title → "SiolFarm Options"
 *  - Single‑column spacing & soft styling (padding/margins/rounded)
 *  - Default group selector to **All** (value 0 or option text "All"), persisted in farmGod_options
 *  - Optional header typewriter/progressive effect (non‑blocking)
 *
 * No changes to logic (Trim/New Barbs/Enter/AutoClose etc.).
 *
 * Configure visual effect with:  window.SF_EFFECTS = 'minimal' | 'typewriter' | 'progressive'
 * Default is 'typewriter'.
 */
(function(){
  'use strict';

  // ---- Config
  var EFFECT = (window.SF_EFFECTS || 'typewriter'); // 'minimal' | 'typewriter' | 'progressive'

  // ---- Helpers
  function ensureStyle(){
    if (document.querySelector('style.sf_ui_style')) return;
    var css = ''+
      '.optionsContent{max-width:780px}\n'+
      '.optionsContent>*{margin:10px 0!important}\n'+
      '.optionsContent h3{font-size:18px;margin-bottom:8px}\n'+
      '.optionsContent .vis, .optionsContent .fg-card, .optionsContent table.vis{border:1px solid #c8c0a8;border-radius:10px;background:#f7f3e7;padding:10px}\n'+
      '.optionsContent .fg-row{display:grid;grid-template-columns:140px 1fr 64px;align-items:center;gap:10px;margin:6px 0}\n'+
      '.optionsContent input[type="range"]{width:100%}\n'+
      '.optionsContent input[type="number"]{width:64px;text-align:center}\n'+
      '.optionsContent .btn, .optionsContent button{padding:6px 12px;border-radius:8px}\n'+
      '.optionsContent .trimButton{background:#d4a657;border:1px solid #a27b34;color:#1b1206}\n'+
      '.optionsContent .newbarbsButton{background:#6aa0e6;border:1px solid #3d6fb8;color:#0b1b2d}\n'+
      '.optionsContent .optionButton{background:#ddd;border:1px solid #aaa}\n'+
      '.optionsContent .sf-credit{text-align:right;font-size:12px;opacity:.75}\n'+
      '.optionsContent .sf-fade{opacity:0;transform:translateY(4px);transition:opacity .18s ease, transform .18s ease}\n'+
      '.optionsContent .sf-fade.sf-in{opacity:1;transform:none}\n';
    var tag = document.createElement('style');
    tag.className = 'sf_ui_style';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function typewriterTitle($h3, text){
    try {
      if (!$h3 || !$h3.length) return;
      var node = $h3[0];
      var i = 0; node.textContent = '';
      var tm = setInterval(function(){
        node.textContent = text.slice(0, ++i);
        if (i >= text.length) clearInterval(tm);
      }, 60);
    } catch(_){}
  }

  function progressiveReveal($opt){
    try{
      var kids = Array.prototype.slice.call($opt.children());
      for (var i=0;i<kids.length;i++){
        var el = kids[i];
        if (el.tagName && el.tagName.toLowerCase()==='h3') continue;
        el.classList.add('sf-fade');
        (function(e, idx){ setTimeout(function(){ e.classList.add('sf-in'); }, 120+idx*90); })(el, i);
      }
    }catch(_){}
  }

  function setGroupDefaultAll($sel){
    try {
      if (!$sel || !$sel.length) return;
      var changed = false;
      if ($sel.find('option[value="0"]').length){ $sel.val('0'); changed = true; }
      else {
        var opts = $sel.find('option');
        for (var i=0;i<opts.length;i++){
          var t = (opts[i].textContent||'').trim().toLowerCase();
          if (t === 'all'){ $sel.val(opts[i].value); changed = true; break; }
        }
      }
      if (changed){
        try{
          var st = JSON.parse(localStorage.getItem('farmGod_options')||'{}');
          st.optionGroup = parseInt($sel.val(),10) || 0;
          localStorage.setItem('farmGod_options', JSON.stringify(st));
        }catch(_){}
      }
    } catch(_){}
  }

  function applyOnce(){
    var $opt = window.jQuery ? window.jQuery('.optionsContent') : null;
    if (!$opt || !$opt.length) return;
    if ($opt.data('sf_ui_applied')) return;
    $opt.data('sf_ui_applied', 1);

    ensureStyle();

    // Rebrand title
    var $h3 = $opt.find('h3').first();
    if ($h3.length){
      var newTitle = 'SiolFarm Options';
      if (EFFECT === 'typewriter') typewriterTitle($h3, newTitle); else $h3.text(newTitle);
    }

    // Default group => All
    var $sel = $opt.find('.optionGroup');
    if ($sel.length) setGroupDefaultAll($sel);

    // Credits
    if (!$opt.find('.sf-credit').length){
      var div = document.createElement('div');
      div.className = 'sf-credit';
      div.textContent = 'By Siolinio';
      $opt[0].appendChild(div);
    }

    // Progressive (optional, non‑blocking)
    if (EFFECT === 'progressive') progressiveReveal($opt[0] ? window.jQuery($opt[0]) : $opt);
  }

  // ---- Bootstrap: run now and watch for dialog
  try { applyOnce(); } catch(_){}
  try {
    var mo = new MutationObserver(function(){ applyOnce(); });
    mo.observe(document.body, { childList:true, subtree:true });
  } catch(_) {
    setInterval(applyOnce, 400);
  }
})();


/* === SiolFarm — Rally page: Scouts optional clamp (non‑destructive) ===
 * If "Scouts optional" is enabled in Options (sf_flags.scoutOpt=true),
 * then on the Rally/Place screen we clamp the requested Scouts to the
 * available count. If available is 0, we set 0 even if prefill asked for 1.
 * Works with any prefill source (Trim, presets, manual). No other logic touched.
 */
(function(){
  'use strict';
  try{ if (!window.game_data || window.game_data.screen !== 'place') return; }catch(_){ return; }

  function loadFlags(){
    try{ var f=JSON.parse(localStorage.getItem('sf_flags')||'{}'); return { scoutOpt: (f.scoutOpt!==false) }; }catch(_){ return { scoutOpt:true }; }
  }
  function q(sel){ try{ return document.querySelector(sel); }catch(_){ return null; } }
  function qAll(sel){ try{ return document.querySelectorAll(sel); }catch(_){ return []; } }
  function digits(str){ var s=String(str||''), out=''; for(var i=0;i<s.length;i++){ var c=s.charCodeAt(i); if (c>=48 && c<=57) out+=s[i]; } return out; }

  function parseAvailSpy(){
    // 1) Parse from onclick="insertUnit('spy', N)"
    var as = qAll('a[onclick],button[onclick]');
    for (var i=0;i<as.length;i++){
      var oc = as[i].getAttribute('onclick')||'';
      if (oc.indexOf('insertUnit')>=0 && oc.indexOf('spy')>=0){
        var start = oc.indexOf(',', oc.indexOf('spy'));
        if (start>=0){
          var num='';
          for (var k=start+1;k<oc.length;k++){
            var ch=oc.charCodeAt(k);
            if (ch>=48 && ch<=57) num+=oc[k];
            else if (num.length>0) break;
          }
          if (num){ var n=parseInt(num,10); if (isFinite(n)) return n; }
        }
      }
    }
    // 2) From data-count or text near unit_link
    var cands = qAll('a.unit_link[data-unit="spy"], a[data-unit="spy"]');
    for (var j=0;j<cands.length;j++){
      var v = cands[j].getAttribute('data-count') || cands[j].textContent || '';
      var n2 = parseInt(digits(v),10); if (isFinite(n2)) return n2;
    }
    // 3) Fallback: look around spy icon
    var img = q('img[src*="unit_spy"], img.unit_spy');
    if (img){
      var txt=''; var p=img.parentElement; var hops=0;
      while (p && hops++<4){ txt+=' '+(p.textContent||''); p=p.nextElementSibling; }
      var n3 = parseInt(digits(txt),10); if (isFinite(n3)) return n3;
    }
    return null;
  }

  function clampSpy(){
    var flags = loadFlags(); if (!flags.scoutOpt) return;
    var input = q('#unit_input_spy, input[name="spy"], input[name="unit_spy"]');
    if (!input) return;
    var want = parseInt(input.value||'0',10); if (!isFinite(want)) want=0;
    var avail = parseAvailSpy();
    if (avail===0){ input.value='0'; return; }
    if (avail!==null && want>avail){ input.value=String(avail); }
  }

  // initial + interactions
  try{ clampSpy(); }catch(_){ }
  document.addEventListener('click', function(ev){
    var a = ev.target.closest ? ev.target.closest('a,button') : null; if (!a) return;
    var oc = a.getAttribute('onclick')||'';
    if (oc.indexOf('insertUnit(')>=0 || (a.className||'').indexOf('farm_icon')>=0 || (a.className||'').indexOf('template')>=0){
      setTimeout(clampSpy,0); setTimeout(clampSpy,120); setTimeout(clampSpy,300);
    }
  }, true);
  document.addEventListener('input', function(ev){
    var el=ev.target; if (!el) return;
    if (el.id==='unit_input_spy' || el.name==='spy' || el.name==='unit_spy') setTimeout(clampSpy,0);
  }, true);
  try{ var mo=new MutationObserver(function(){ clampSpy(); }); mo.observe(document.body,{childList:true,subtree:true}); }catch(_){ setInterval(clampSpy,500); }
})();
