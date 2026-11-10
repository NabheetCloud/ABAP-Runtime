@EndUserText.label : 'Sales order header - draft'
define table zorder_hd {
  key mandt          : abap.clnt not null;
  key orderid        : abap.numc(10) not null;
  customer           : abap.char(60);
  orderdate          : abap.dats;
  currency           : abap.cuky;
  total              : abap.curr(16,2);
  status             : abap.char(1);
  createdby          : abp_creation_user;
  createdat          : abp_creation_tstmpl;
  lastchangedby      : abp_lastchange_user;
  lastchangedat      : abp_lastchange_tstmpl;
  locallastchangedat : abp_locinst_lastchange_tstmpl;
  "%admin"           : include sych_bdl_draft_admin_inc;
}
