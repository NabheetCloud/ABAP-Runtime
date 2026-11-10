@EndUserText.label : 'Role transactions/apps'
define table agr_tcodes {
  key mandt    : abap.clnt not null;
  key agr_name : abap.char(30) not null;
  key type     : abap.char(1) not null;
  key tcode    : abap.char(20) not null;
}
