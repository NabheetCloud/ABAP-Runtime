sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, Filter, FilterOperator, MessageToast, MessageBox) {
  "use strict";
  const NS = "com.sap.gateway.srvd.zui_travel.v0001";

  return Controller.extend("z.travels.controller.Main", {
    onSearch: function (oEvent) {
      const sQuery = oEvent.getParameter("query");
      const oBinding = this.byId("travels").getBinding("items");
      oBinding.filter(sQuery ? [new Filter("Description", FilterOperator.Contains, sQuery)] : []);
    },

    // call the RAP action acceptTravel (bound action of the Travel entity)
    onAccept: function (oEvent) {
      const oContext = oEvent.getSource().getBindingContext();
      const oAction = oContext.getModel().bindContext(NS + ".acceptTravel(...)", oContext);
      oAction.execute().then(function () {
        MessageToast.show("Travel accepted");
        oContext.refresh();
      }).catch(function (oError) {
        MessageBox.error(oError.message);
      });
    }
  });
});
