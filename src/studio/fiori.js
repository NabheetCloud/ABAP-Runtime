// Generator for SAP Fiori elements (OData V4) applications on top of a RAP service, like SAP Fiori tools does.
// Templates:
//   lrop      List Report + Object Page (+ object pages for composition children)
//   worklist  List Report without filter bar + Object Page
//   alp       Analytical List Page (chart + table, needs @UI.chart / @Aggregation.default in CDS)
//   fpm       Flexible Programming Model: custom XML view with Fiori elements building blocks
//   ovp       Overview Page: list + table cards for the entity set, analytical cards for every @UI.chart in the service
// The app is written to <workspace>/webapp/<name>/ and served at /apps/<name>/ (or /a/<app>/apps/<name>/ in the studio).
import fs from 'node:fs';
import path from 'node:path';

export const TEMPLATES = {
  lrop: 'List Report Object Page',
  worklist: 'Worklist',
  alp: 'Analytical List Page',
  fpm: 'Custom page (Flexible Programming Model)',
  ovp: 'Overview Page',
  freestyle: 'Freestyle SAPUI5 (list + detail, your own views)',
};

const UI5 = 'https://ui5.sap.com/resources/sap-ui-core.js';

export function generateFioriApp(dir, { template = 'lrop', service, entitySet, name, title, uiMetadata }) {
  if (!TEMPLATES[template]) throw Object.assign(new Error(`Unknown template ${template}. Use one of: ${Object.keys(TEMPLATES).join(', ')}`), { status: 400 });
  if (!uiMetadata.entitySets[entitySet]) throw Object.assign(new Error(`Entity set ${entitySet} is not exposed by ${service}`), { status: 400 });
  const appName = (name || `${entitySet}-${template}`).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const ns = `z.${appName.replace(/-/g, '')}`;
  const out = path.join(dir, 'webapp', appName);
  fs.mkdirSync(out, { recursive: true });
  const set = uiMetadata.entitySets[entitySet];
  const appTitle = title || set.ui.headerInfo?.typenameplural || set.label || entitySet;
  const serviceUrl = `../../odata/${service.toLowerCase()}/`;

  if (template === 'ovp') return generateOverviewPage({ out, ns, appName, appTitle, serviceUrl, entitySet, set, uiMetadata, dir });
  if (template === 'freestyle') return generateFreestyleApp({ out, ns, appName, appTitle, serviceUrl, service, entitySet, set, uiMetadata, dir });
  const routing = buildRouting(template, entitySet, set, uiMetadata, ns);
  const manifest = {
    '_version': '1.59.0',
    'sap.app': {
      id: ns, type: 'application', title: appTitle, description: `${TEMPLATES[template]} for ${entitySet}`,
      applicationVersion: { version: '1.0.0' },
      dataSources: { mainService: { uri: serviceUrl, type: 'OData', settings: { annotations: [], odataVersion: '4.0' } } },
      sourceTemplate: { id: `@sap/generator-fiori:${template}`, version: '1.0.0' },
    },
    'sap.ui': { technology: 'UI5', deviceTypes: { desktop: true, tablet: true, phone: true } },
    'sap.ui5': {
      flexEnabled: false,
      dependencies: { minUI5Version: '1.120.0', libs: { 'sap.m': {}, 'sap.ui.core': {}, 'sap.fe.templates': {}, ...(template === 'fpm' ? { 'sap.fe.core': {}, 'sap.fe.macros': {} } : {}), ...(template === 'alp' ? { 'sap.chart': {}, 'sap.viz': {}, 'sap.fe.macros': {} } : {}) } },
      contentDensities: { compact: true, cozy: true },
      models: {
        i18n: { type: 'sap.ui.model.resource.ResourceModel', settings: { bundleName: `${ns}.i18n.i18n` } },
        '': { dataSource: 'mainService', preload: true, settings: { operationMode: 'Server', autoExpandSelect: true, earlyRequests: true } },
        '@i18n': { type: 'sap.ui.model.resource.ResourceModel', uri: 'i18n/i18n.properties' },
      },
      resources: { css: [] },
      routing,
    },
    'sap.fiori': { registrationIds: [], archeType: 'transactional' },
  };
  write(out, 'manifest.json', JSON.stringify(manifest, null, 2));
  write(out, 'Component.js', `sap.ui.define(["sap/fe/core/AppComponent"], function (Component) {
  "use strict";
  return Component.extend("${ns}.Component", {
    metadata: { manifest: "json" }
  });
});
`);
  write(out, 'i18n/i18n.properties', `appTitle=${appTitle}\nappDescription=${TEMPLATES[template]}\n`);
  write(out, 'index.html', `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appTitle}</title>
  <style>html, body, body > div, #container, #container-uiarea { height: 100%; }</style>
  <script id="sap-ui-bootstrap"
    src="${UI5}"
    data-sap-ui-theme="sap_horizon"
    data-sap-ui-resource-roots='{ "${ns}": "./" }'
    data-sap-ui-on-init="module:sap/ui/core/ComponentSupport"
    data-sap-ui-compat-version="edge"
    data-sap-ui-async="true"
    data-sap-ui-frame-options="trusted"></script>
</head>
<body class="sapUiBody sapUiSizeCompact" id="content">
  <div data-sap-ui-component data-name="${ns}" data-id="container" data-settings='{"id": "${ns}"}' data-handle-validation="true"></div>
</body>
</html>
`);
  if (template === 'fpm') {
    write(out, 'ext/main/Main.view.xml', `<mvc:View xmlns:core="sap.ui.core" xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m"
  xmlns:macros="sap.fe.macros" xmlns:html="http://www.w3.org/1999/xhtml" controllerName="${ns}.ext.main.Main">
  <Page id="Main" title="${appTitle}">
    <content>
      <macros:FilterBar metaPath="@com.sap.vocabularies.UI.v1.SelectionFields" id="FilterBar" liveMode="true"/>
      <macros:Table metaPath="@com.sap.vocabularies.UI.v1.LineItem" id="Table" filterBar="FilterBar"
        readOnly="true" type="ResponsiveTable" variantManagement="None"/>
    </content>
  </Page>
</mvc:View>
`);
    write(out, 'ext/main/Main.controller.js', `sap.ui.define(["sap/fe/core/PageController"], function (PageController) {
  "use strict";
  return PageController.extend("${ns}.ext.main.Main", {
    // add your own event handlers here; this.editFlow / this.routing give access to Fiori elements services
  });
});
`);
  }
  return { name: appName, path: path.relative(dir, out), url: `apps/${appName}/` };
}

// ---------------------------------------------------------------------------------------------------------
// Freestyle SAPUI5: a real UI5 component (Component.js + manifest.json + routing) with a list and a detail page,
// built from the service's annotations. A starting point the developer (or the AI agent) customizes.
export function componentFiles({ ns, appTitle, serviceUrl, rootView, routing, libs = ['sap.m'], description = 'Freestyle SAPUI5 app' }) {
  const manifest = {
    '_version': '1.59.0',
    'sap.app': {
      id: ns, type: 'application', title: '{{appTitle}}', description, applicationVersion: { version: '1.0.0' },
      i18n: 'i18n/i18n.properties',
      dataSources: { mainService: { uri: serviceUrl, type: 'OData', settings: { odataVersion: '4.0' } } },
    },
    'sap.ui': { technology: 'UI5', deviceTypes: { desktop: true, tablet: true, phone: true } },
    'sap.ui5': {
      rootView: { viewName: rootView, type: 'XML', id: 'app' },
      dependencies: { minUI5Version: '1.120.0', libs: Object.fromEntries([...new Set(['sap.ui.core', ...libs])].map(l => [l, {}])) },
      contentDensities: { compact: true, cozy: true },
      models: {
        i18n: { type: 'sap.ui.model.resource.ResourceModel', settings: { bundleName: `${ns}.i18n.i18n` } },
        '': { dataSource: 'mainService', preload: true, settings: { operationMode: 'Server', autoExpandSelect: true, earlyRequests: true, groupId: '$auto', updateGroupId: '$auto' } },
      },
      ...(routing ? { routing } : {}),
    },
  };
  return {
    'manifest.json': JSON.stringify(manifest, null, 2) + '\n',
    'Component.js': `sap.ui.define(["sap/ui/core/UIComponent"], function (UIComponent) {
  "use strict";
  return UIComponent.extend("${ns}.Component", {
    metadata: { manifest: "json", interfaces: ["sap.ui.core.IAsyncContentCreation"] },
    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
${routing ? '      this.getRouter().initialize();\n' : ''}    }
  });
});
`,
    'i18n/i18n.properties': `appTitle=${appTitle}\nappDescription=${description}\n`,
    'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appTitle}</title>
  <style>html, body, body > div, #container, #container-uiarea { height: 100%; }</style>
  <script id="sap-ui-bootstrap"
    src="${UI5}"
    data-sap-ui-theme="sap_horizon"
    data-sap-ui-resource-roots='{ "${ns}": "./" }'
    data-sap-ui-on-init="module:sap/ui/core/ComponentSupport"
    data-sap-ui-compat-version="edge"
    data-sap-ui-async="true"
    data-sap-ui-frame-options="trusted"></script>
</head>
<body class="sapUiBody sapUiSizeCompact" id="content">
  <div data-sap-ui-component data-name="${ns}" data-id="container" data-settings='{"id": "${ns}"}' data-handle-validation="true"></div>
</body>
</html>
`,
  };
}

function generateFreestyleApp({ out, ns, appName, appTitle, serviceUrl, service, entitySet, set, uiMetadata, dir }) {
  const xa = v => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const field = n => set.fields.find(f => f.name === n);
  const label = n => field(n)?.label || n;
  const bind = n => { const f = field(n); return f?.text ? `{${f.text}} ({${n}})` : `{${n}}`; };   // "Text (Key)" like Fiori
  const visible = set.fields.filter(f => !f.hidden && !/^(IsActiveEntity|HasActiveEntity|HasDraftEntity)$/.test(f.name));
  const cols = (set.ui.lineItem.filter(i => i.type === '#STANDARD').sort((a, b) => a.position - b.position).map(i => i.value).filter(field).slice(0, 7));
  const columns = cols.length ? cols : visible.slice(0, 6).map(f => f.name);
  const formFields = [...new Set([...set.ui.identification.filter(i => i.type === '#STANDARD').map(i => i.value), ...Object.values(set.ui.fieldGroups || {}).flat().map(i => i.value)])].filter(field);
  const detailFields = formFields.length ? formFields : visible.map(f => f.name);
  const titleField = set.ui.headerInfo?.title?.value || columns[0];
  const descField = set.ui.headerInfo?.description?.value;
  const actions = (set.actions || []).filter(a => !a.static && !a.parameters?.length && !/^(Edit|Activate|Discard|Resume|Prepare)$/.test(a.name));
  const child = (set.navigation || []).find(n => n.composition && n.many && uiMetadata.entitySets[n.target]);
  const childSet = child && uiMetadata.entitySets[child.target];
  const childCols = childSet ? (childSet.ui.lineItem.filter(i => i.type === '#STANDARD').sort((a, b) => a.position - b.position).map(i => i.value).filter(v => childSet.fields.some(f => f.name === v)).slice(0, 6)) : [];
  const srvNs = `com.sap.gateway.srvd.${service.toLowerCase()}.v0001`;
  const listFilter = set.draft ? `, filters: [{ path: 'IsActiveEntity', operator: 'EQ', value1: true }]` : '';

  const routing = {
    config: { routerClass: 'sap.m.routing.Router', type: 'View', viewType: 'XML', path: `${ns}.view`, controlId: 'app', controlAggregation: 'pages', async: true },
    routes: [{ name: 'list', pattern: '', target: 'list' }, { name: 'detail', pattern: 'detail/{key}', target: 'detail' }],
    targets: { list: { id: 'list', name: 'List', level: 1 }, detail: { id: 'detail', name: 'Detail', level: 2 } },
  };
  const files = componentFiles({ ns, appTitle, serviceUrl, rootView: `${ns}.view.App`, routing, libs: ['sap.m', 'sap.ui.layout'] });
  files['view/App.view.xml'] = `<mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m" displayBlock="true">
  <App id="app"/>
</mvc:View>
`;
  files['view/List.view.xml'] = `<mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m" controllerName="${ns}.controller.List">
  <Page id="listPage" title="{i18n>appTitle}">
    <content>
      <Table id="table" growing="true" growingThreshold="20" sticky="ColumnHeaders,HeaderToolbar"
        items="{ path: '/${entitySet}'${listFilter}, parameters: { $count: true } }">
        <headerToolbar>
          <OverflowToolbar>
            <Title id="tableTitle" text="${xa(set.ui.headerInfo?.typenameplural || set.label)}"/>
            <ToolbarSpacer/>
            <SearchField id="search" width="16rem" search=".onSearch"/>
          </OverflowToolbar>
        </headerToolbar>
        <columns>
${columns.map(c => `          <Column><Text text="${xa(label(c))}"/></Column>`).join('\n')}
        </columns>
        <items>
          <ColumnListItem type="Navigation" press=".onPress">
            <cells>
${columns.map(c => `              <Text text="${xa(bind(c))}"/>`).join('\n')}
            </cells>
          </ColumnListItem>
        </items>
      </Table>
    </content>
  </Page>
</mvc:View>
`;
  files['controller/List.controller.js'] = `sap.ui.define([
  "sap/ui/core/mvc/Controller"
], function (Controller) {
  "use strict";
  return Controller.extend("${ns}.controller.List", {
    onSearch: function (oEvent) {
      // OData V4 $search on the RAP service (@Search.searchable)
      this.byId("table").getBinding("items").changeParameters({ $search: oEvent.getParameter("query") || undefined });
    },
    onPress: function (oEvent) {
      const sPath = oEvent.getSource().getBindingContext().getPath();       // e.g. /${entitySet}(...)
      this.getOwnerComponent().getRouter().navTo("detail", { key: encodeURIComponent(sPath.slice(1)) });
    }
  });
});
`;
  files['view/Detail.view.xml'] = `<mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m" xmlns:f="sap.ui.layout.form" controllerName="${ns}.controller.Detail">
  <Page id="detailPage" title="${xa(set.ui.headerInfo?.typename || set.label)}" showNavButton="true" navButtonPress=".onBack">
    <headerContent>
${actions.map(a => `      <Button text="${xa(a.label || a.name)}" press=".onAction"><customData><core:CustomData xmlns:core="sap.ui.core" key="action" value="${xa(a.name)}"/></customData></Button>`).join('\n')}
    </headerContent>
    <content>
      <ObjectHeader title="${xa(bind(titleField))}"${descField ? ` intro="${xa(bind(descField))}"` : ''}/>
      <f:SimpleForm id="form" editable="false" layout="ColumnLayout" columnsM="2" columnsL="2">
        <f:content>
${detailFields.map(n => `          <Label text="${xa(label(n))}"/>\n          <Text text="${xa(bind(n))}"/>`).join('\n')}
        </f:content>
      </f:SimpleForm>
${childSet ? `      <Table id="childTable" headerText="${xa(childSet.ui.headerInfo?.typenameplural || childSet.label)}" items="{${child.name}}">
        <columns>
${childCols.map(c => `          <Column><Text text="${xa(childSet.fields.find(f => f.name === c)?.label || c)}"/></Column>`).join('\n')}
        </columns>
        <items>
          <ColumnListItem>
            <cells>
${childCols.map(c => `              <Text text="{${c}}"/>`).join('\n')}
            </cells>
          </ColumnListItem>
        </items>
      </Table>
` : ''}    </content>
  </Page>
</mvc:View>
`;
  files['controller/Detail.controller.js'] = `sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, MessageToast, MessageBox) {
  "use strict";
  return Controller.extend("${ns}.controller.Detail", {
    onInit: function () {
      this.getOwnerComponent().getRouter().getRoute("detail").attachPatternMatched(this._onMatched, this);
    },
    _onMatched: function (oEvent) {
      this.getView().bindElement({ path: "/" + decodeURIComponent(oEvent.getParameter("arguments").key) });
    },
    onBack: function () {
      this.getOwnerComponent().getRouter().navTo("list");
    },
    onAction: function (oEvent) {
      // bound RAP action, e.g. ${srvNs}.<action>
      const sAction = oEvent.getSource().data("action");
      const oContext = this.getView().getBindingContext();
      const oOperation = this.getView().getModel().bindContext("${srvNs}." + sAction + "(...)", oContext);
      oOperation.execute().then(function () {
        MessageToast.show(sAction + " done");
        oContext.refresh();
      }, function (oError) {
        MessageBox.error(oError.message);
      });
    }
  });
});
`;
  for (const [f, c] of Object.entries(files)) write(out, f, c);
  return { name: appName, path: path.relative(dir, out), url: `apps/${appName}/` };
}

function generateOverviewPage({ out, ns, appName, appTitle, serviceUrl, entitySet, set, uiMetadata, dir }) {
  const cards = {};
  const title = s => uiMetadata.entitySets[s].ui.headerInfo?.typenameplural || s;
  cards[`${entitySet}_list`] = { model: 'mainService', template: 'sap.ovp.cards.v4.list', settings: { title: title(entitySet), subTitle: 'Latest', entitySet, listType: 'extended', listFlavor: 'standard', annotationPath: 'com.sap.vocabularies.UI.v1.LineItem', addODataSelect: true } };
  cards[`${entitySet}_table`] = { model: 'mainService', template: 'sap.ovp.cards.v4.table', settings: { title: `${title(entitySet)} (table)`, entitySet, annotationPath: 'com.sap.vocabularies.UI.v1.LineItem', addODataSelect: true } };
  for (const [name, es] of Object.entries(uiMetadata.entitySets)) {
    for (const c of es.ui.charts || []) {
      cards[`${name}_${c.qualifier || 'chart'}`] = { model: 'mainService', template: 'sap.ovp.cards.v4.charts.analytical', settings: {
        title: c.title || `${title(name)} chart`, entitySet: name,
        chartAnnotationPath: `com.sap.vocabularies.UI.v1.Chart${c.qualifier ? '#' + c.qualifier : ''}`,
        presentationAnnotationPath: 'com.sap.vocabularies.UI.v1.PresentationVariant',
      } };
    }
  }
  const manifest = {
    '_version': '1.59.0',
    'sap.app': {
      id: ns, type: 'application', title: appTitle, description: 'Overview Page', applicationVersion: { version: '1.0.0' },
      dataSources: { mainService: { uri: serviceUrl, type: 'OData', settings: { annotations: [], odataVersion: '4.0' } } },
      sourceTemplate: { id: '@sap/generator-fiori:ovp', version: '1.0.0' },
    },
    'sap.ui': { technology: 'UI5', deviceTypes: { desktop: true, tablet: true, phone: true } },
    'sap.ui5': {
      dependencies: { minUI5Version: '1.120.0', libs: { 'sap.m': {}, 'sap.ui.core': {}, 'sap.ovp': {}, 'sap.ui.layout': {}, 'sap.f': {}, 'sap.viz': {}, 'sap.suite.ui.microchart': {} } },
      contentDensities: { compact: true, cozy: true },
      models: {
        '@i18n': { type: 'sap.ui.model.resource.ResourceModel', uri: 'i18n/i18n.properties' },
        mainService: { dataSource: 'mainService', preload: true, settings: { operationMode: 'Server', autoExpandSelect: true, earlyRequests: true, groupId: '$auto' } },
      },
    },
    'sap.ovp': {
      globalFilterModel: 'mainService', globalFilterEntitySet: entitySet, containerLayout: 'resizable', enableLiveFilter: true,
      considerAnalyticalParameters: false, cards,
    },
    'sap.fiori': { registrationIds: [], archeType: 'analytical' },
  };
  write(out, 'manifest.json', JSON.stringify(manifest, null, 2));
  write(out, 'Component.js', `sap.ui.define(["sap/ovp/app/Component"], function (Component) {
  "use strict";
  return Component.extend("${ns}.Component", {
    metadata: { manifest: "json" }
  });
});
`);
  write(out, 'i18n/i18n.properties', `appTitle=${appTitle}\nappDescription=Overview Page\n`);
  // the Overview Page runs inside the SAP Fiori launchpad shell: use the launchpad sandbox (like Fiori tools' flpSandbox.html)
  write(out, 'index.html', `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appTitle}</title>
  <script>
    if (!location.hash) location.hash = '#app-display';
    window['sap-ushell-config'] = {
      defaultRenderer: 'fiori2',
      renderers: { fiori2: { componentData: { config: { enableSearch: false, rootIntent: 'app-display' } } } },
      applications: {
        'app-display': { title: ${JSON.stringify(appTitle)}, description: 'Overview Page', additionalInformation: 'SAPUI5.Component=${ns}', applicationType: 'URL', url: './' }
      }
    };
  </script>
  <script id="sap-ushell-bootstrap" src="https://ui5.sap.com/test-resources/sap/ushell/bootstrap/sandbox.js"></script>
  <script id="sap-ui-bootstrap"
    src="${UI5}"
    data-sap-ui-libs="sap.m, sap.ui.core, sap.ushell, sap.ovp"
    data-sap-ui-theme="sap_horizon"
    data-sap-ui-resource-roots='{ "${ns}": "./" }'
    data-sap-ui-compat-version="edge"
    data-sap-ui-async="true"
    data-sap-ui-frame-options="allow"></script>
  <script>
    sap.ui.getCore().attachInit(function () { sap.ushell.Container.createRenderer().placeAt('content'); });
  </script>
</head>
<body class="sapUiBody" id="content"></body>
</html>
`);
  return { name: appName, path: path.relative(dir, out), url: `apps/${appName}/` };
}

function indexHtml(ns, appTitle) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appTitle}</title>
  <style>html, body, body > div, #container, #container-uiarea { height: 100%; }</style>
  <script id="sap-ui-bootstrap"
    src="${UI5}"
    data-sap-ui-theme="sap_horizon"
    data-sap-ui-resource-roots='{ "${ns}": "./" }'
    data-sap-ui-on-init="module:sap/ui/core/ComponentSupport"
    data-sap-ui-compat-version="edge"
    data-sap-ui-async="true"
    data-sap-ui-frame-options="trusted"></script>
</head>
<body class="sapUiBody sapUiSizeCompact" id="content">
  <div data-sap-ui-component data-name="${ns}" data-id="container" data-settings='{"id": "${ns}"}' data-handle-validation="true"></div>
</body>
</html>
`;
}

function write(dir, file, content) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

function buildRouting(template, entitySet, set, ui, ns) {
  const routes = [];
  const targets = {};
  const listId = `${entitySet}List`;
  const opId = `${entitySet}ObjectPage`;
  if (template === 'fpm') {
    routes.push({ pattern: ':?query:', name: 'Main', target: 'Main' });
    targets.Main = { type: 'Component', id: 'Main', name: 'sap.fe.core.fpm', options: { settings: { viewName: `${ns}.ext.main.Main`, contextPath: `/${entitySet}`, navigation: { [entitySet]: { detail: { route: opId } } } } } };
  } else {
    const listSettings = {
      contextPath: `/${entitySet}`,
      variantManagement: 'Page',
      navigation: { [entitySet]: { detail: { route: opId } } },
      controlConfiguration: { '@com.sap.vocabularies.UI.v1.LineItem': { tableSettings: { type: 'ResponsiveTable', selectionMode: 'Multi' } } },
    };
    // entity with a recursive hierarchy: tree table
    const hq = set?.hierarchyQualifier;
    if (hq) listSettings.controlConfiguration['@com.sap.vocabularies.UI.v1.LineItem'].tableSettings = { type: 'TreeTable', hierarchyQualifier: hq, selectionMode: 'Single' };
    if (template === 'worklist') listSettings.hideFilterBar = true;
    if (template === 'alp') {
      listSettings.views = { paths: [{ primary: [{ annotationPath: 'com.sap.vocabularies.UI.v1.PresentationVariant' }], secondary: [{ annotationPath: 'com.sap.vocabularies.UI.v1.LineItem' }], defaultPath: 'both' }] };
    }
    routes.push({ pattern: ':?query:', name: listId, target: listId });
    targets[listId] = { type: 'Component', id: listId, name: template === 'alp' ? 'sap.fe.templates.AnalyticalListPage' : 'sap.fe.templates.ListReport', options: { settings: listSettings } };
  }
  // object pages for the root and (recursively) its composition children
  const addObjectPage = (setName, pattern, contextPath, routeId, depth) => {
    const s = ui.entitySets[setName];
    if (!s || depth > 3) return;
    const navigation = {};
    const children = s.navigation.filter(n => n.composition && n.target && ui.entitySets[n.target]);
    for (const n of children) navigation[n.name] = { detail: { route: `${n.target}ObjectPage` } };
    routes.push({ pattern: `${pattern}:?query:`, name: routeId, target: routeId });
    targets[routeId] = { type: 'Component', id: routeId, name: 'sap.fe.templates.ObjectPage', options: { settings: { editableHeaderContent: false, contextPath, navigation } } };
    for (const n of children) {
      if (routes.some(r => r.name === `${n.target}ObjectPage`)) continue;
      addObjectPage(n.target, `${pattern}/${n.name}({key${depth + 2}})`, `${contextPath}/${n.name}`, `${n.target}ObjectPage`, depth + 1);
    }
  };
  addObjectPage(entitySet, `${entitySet}({key})`, `/${entitySet}`, opId, 0);
  return { config: {}, routes, targets };
}
