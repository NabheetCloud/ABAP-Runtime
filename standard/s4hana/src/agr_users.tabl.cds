@EndUserText.label : 'Role ↔ user'
define table agr_users {
  key mandt    : abap.clnt not null;
  key agr_name : abap.char(30) not null;
  key uname    : abap.char(12) not null;
  key from_dat : abap.dats not null;
  key to_dat   : abap.dats not null;
  exclude      : abap.char(20);
}
