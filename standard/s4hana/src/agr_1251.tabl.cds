@EndUserText.label : 'Role authorizations'
define table agr_1251 {
  key mandt    : abap.clnt not null;
  key agr_name : abap.char(30) not null;
  key counter  : abap.numc(6) not null;
  object       : abap.char(20);
  auth         : abap.char(20);
  low          : abap.char(20);
  high         : abap.char(20);
  field        : abap.char(20);
}
