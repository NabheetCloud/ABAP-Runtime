// OData V2 explorer: a page under <app>/sap/opu/odata/ that tests the app's V2 services with the real SAPUI5
// V2 model (sap.ui.model.odata.v2.ODataModel, $batch on): pick a service and an entity set, filter and page
// through it, open a record, call its function imports, and look at the $metadata.
export function v2ExplorerPage(services) {
  const list = JSON.stringify(services.map(s => s.name.toUpperCase()));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OData V2 services</title>
<script id="sap-ui-bootstrap" src="https://ui5.sap.com/resources/sap-ui-core.js" data-sap-ui-libs="sap.m" data-sap-ui-theme="sap_horizon"
  data-sap-ui-async="true" data-sap-ui-compatVersion="edge"></script>
<style>html,body{height:100%;margin:0}.v2-note{margin:0 0 .5rem;color:#556b82;font-size:.875rem}</style>
<script>
sap.ui.getCore().attachInit(function () {
  sap.ui.require(['sap/ui/model/odata/v2/ODataModel', 'sap/ui/model/json/JSONModel', 'sap/m/Page', 'sap/m/OverflowToolbar', 'sap/m/ToolbarSpacer', 'sap/m/Select',
    'sap/ui/core/Item', 'sap/m/Label', 'sap/m/SearchField', 'sap/m/Table', 'sap/m/Column', 'sap/m/Text', 'sap/m/ColumnListItem', 'sap/m/Button', 'sap/m/Dialog',
    'sap/m/MessageBox', 'sap/m/MessageToast', 'sap/m/Link', 'sap/m/VBox', 'sap/m/Input', 'sap/m/Title', 'sap/ui/model/Filter', 'sap/ui/model/FilterOperator', 'sap/m/MessageStrip'],
  function (ODataModel, JSONModel, Page, Toolbar, Spacer, Select, Item, Label, SearchField, Table, Column, Text, ColumnListItem, Button, Dialog, MessageBox, MessageToast, Link, VBox, Input, Title, Filter, FO, MessageStrip) {
    var services = ${list};
    var state = { model: null, meta: null, set: null };
    var svcSel = new Select({ width: '14rem', selectedKey: services[0], items: services.map(function (s) { return new Item({ key: s, text: s }); }), change: function () { loadService(); } });
    var setSel = new Select({ width: '12rem', change: function () { showSet(); } });
    var search = new SearchField({ width: '14rem', placeholder: 'Search text fields', search: function () { showSet(); } });
    var count = new Text();
    var metaLink = new Link({ text: '$metadata', target: '_blank' });
    var table = new Table({ growing: true, growingThreshold: 20, sticky: ['ColumnHeaders'], mode: 'None' });
    var strip = new MessageStrip({ type: 'Information', showIcon: true, text: 'Every request goes through the SAPUI5 OData V2 model ($batch) to /sap/opu/odata/sap/<SERVICE>/, which answers in the V2 format.' });
    var page = new Page({ title: 'OData V2 services', content: [strip.addStyleClass('sapUiSmallMargin'), table],
      subHeader: new Toolbar({ content: [svcSel, setSel, search, new Spacer(), count, metaLink] }) });
    page.placeAt(document.body);
    if (!services.length) { strip.setType('Warning').setText('This app has no service yet. Add a service definition and it appears here.'); return; }

    function loadService() {
      var name = svcSel.getSelectedKey();
      var url = '${'${base}'}' + name + '/';
      metaLink.setHref(url + '$metadata');
      state.model = new ODataModel(url, { useBatch: true, defaultCountMode: 'Inline' });
      table.setModel(state.model);
      state.model.attachRequestFailed(function (e) { var r = e.getParameter('response'); MessageBox.error(errorText(r && r.responseText)); });
      state.model.metadataLoaded().then(function () {
        state.meta = state.model.getServiceMetadata().dataServices.schema[0];
        var sets = state.meta.entityContainer[0].entitySet || [];
        setSel.removeAllItems();
        sets.forEach(function (s) { setSel.addItem(new Item({ key: s.name, text: s.name })); });
        if (sets.length) setSel.setSelectedKey(sets[0].name);
        showSet();
      });
    }
    function typeOf(setName) {
      var set = state.meta.entityContainer[0].entitySet.filter(function (s) { return s.name === setName; })[0];
      var tn = set.entityType.split('.').pop();
      return state.meta.entityType.filter(function (t) { return t.name === tn; })[0];
    }
    function label(p) { var a = (p.extensions || []).filter(function (e) { return e.name === 'label'; })[0]; return a ? a.value : p.name; }
    function fmt(p) {
      if (p.type === 'Edm.DateTime') return { path: p.name, type: 'sap.ui.model.odata.type.DateTime', constraints: { displayFormat: 'Date' } };
      if (p.type === 'Edm.DateTimeOffset') return { path: p.name, type: 'sap.ui.model.odata.type.DateTimeOffset' };
      if (p.type === 'Edm.Decimal') return { path: p.name, type: 'sap.ui.model.odata.type.Decimal', constraints: { scale: Number(p.scale || 2) } };
      if (p.type === 'Edm.Boolean') return { path: p.name, formatter: function (v) { return v ? 'Yes' : 'No'; } };
      return { path: p.name };
    }
    function showSet() {
      var setName = setSel.getSelectedKey();
      if (!setName) return;
      var type = typeOf(setName);
      var props = (type.property || []).filter(function (p) { return p.type !== 'Edm.Guid' || (type.key.propertyRef.length === 1 && false); }).slice(0, 7);
      table.removeAllColumns();
      props.forEach(function (p) { table.addColumn(new Column({ header: new Label({ text: label(p) }), hAlign: p.type === 'Edm.Decimal' ? 'End' : 'Begin' })); });
      var filters = [];
      var draft = (type.property || []).some(function (p) { return p.name === 'IsActiveEntity'; });
      if (draft) filters.push(new Filter('IsActiveEntity', FO.EQ, true));
      var q = search.getValue();
      if (q) {
        var text = (type.property || []).filter(function (p) { return p.type === 'Edm.String'; });
        if (text.length) filters.push(new Filter({ filters: text.map(function (p) { return new Filter(p.name, FO.Contains, q); }), and: false }));
      }
      table.bindItems({ path: '/' + setName, filters: filters, template: new ColumnListItem({ type: 'Navigation', press: open,
        cells: props.map(function (p) { return new Text({ text: fmt(p) }); }) }),
        events: { dataReceived: function (e) { var d = e.getParameter('data'); count.setText(d && d.__count !== undefined ? d.__count + ' records' : ''); } } });
      state.set = setName; state.type = type;
    }
    function open(e) {
      var ctx = e.getSource().getBindingContext();
      var obj = ctx.getObject();
      var type = state.type;
      var fis = (state.meta.entityContainer[0].functionImport || []).filter(function (f) {
        return (f.extensions || []).some(function (x) { return x.name === 'action-for' && x.value.split('.').pop() === type.name; });
      });
      var rows = (type.property || []).map(function (p) { return new VBox({ items: [new Label({ text: label(p) }), new Text({ text: fmt(p) })] }).addStyleClass('sapUiTinyMarginBottom'); });
      var dlg = new Dialog({ title: state.set, contentWidth: '32rem', content: [new VBox({ items: rows }).addStyleClass('sapUiSmallMargin')],
        buttons: fis.map(function (f) { return new Button({ text: f.name, press: function () { callFunction(f, obj, dlg); } }); }).concat([new Button({ text: 'Close', press: function () { dlg.close(); } })]),
        afterClose: function () { dlg.destroy(); } });
      dlg.setModel(state.model); dlg.setBindingContext(ctx); dlg.open();
    }
    function callFunction(f, obj, dlg) {
      var keyNames = state.type.key.propertyRef.map(function (k) { return k.name; });
      var params = {}; keyNames.forEach(function (k) { params[k] = obj[k]; });
      var extra = (f.parameter || []).filter(function (p) { return keyNames.indexOf(p.name) < 0; });
      var go = function () {
        state.model.callFunction('/' + f.name, { method: 'POST', urlParameters: params,
          success: function () { MessageToast.show(f.name + ' done'); dlg.close(); state.model.refresh(true); },
          error: function () {} });
      };
      if (!extra.length) return go();
      var inputs = extra.map(function (p) { return new Input({ placeholder: p.name }); });
      var ask = new Dialog({ title: f.name, content: inputs.map(function (i, n) { return new VBox({ items: [new Label({ text: extra[n].name }), i] }).addStyleClass('sapUiSmallMargin'); }),
        beginButton: new Button({ text: 'Run', type: 'Emphasized', press: function () { extra.forEach(function (p, n) { params[p.name] = inputs[n].getValue(); }); ask.close(); go(); } }),
        endButton: new Button({ text: 'Cancel', press: function () { ask.close(); } }), afterClose: function () { ask.destroy(); } });
      ask.open();
    }
    function errorText(t) { try { return JSON.parse(t).error.message.value; } catch (e) { return t || 'Request failed'; } }
    loadService();
  });
});
</script></head><body class="sapUiBody"></body></html>`;
}
