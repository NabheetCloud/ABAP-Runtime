@EndUserText.label : 'Travel - draft table'
define table ztravel_d {
  key mandt            : abap.clnt not null;
  key traveluuid       : sysuuid_x16 not null;
  travelid             : abap.numc(8);
  customerid           : abap.numc(6);
  description          : abap.char(256);
  begindate            : abap.dats;
  enddate              : abap.dats;
  bookingfee           : abap.curr(16,2);
  totalprice           : abap.curr(16,2);
  currencycode         : abap.cuky;
  overallstatus        : abap.char(1);
  rejectreason         : abap.char(80);
  createdby            : abp_creation_user;
  createdat            : abp_creation_tstmpl;
  lastchangedby        : abp_lastchange_user;
  lastchangedat        : abp_lastchange_tstmpl;
  locallastchangedat   : abp_locinst_lastchange_tstmpl;
  "%admin"             : include sych_bdl_draft_admin_inc;
}
