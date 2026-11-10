@EndUserText.label : 'IDoc status records'
define table edids {
  key mandt  : abap.clnt not null;
  key docnum : abap.char(16) not null;
  key logdat : abap.dats not null;
  key logtim : abap.tims not null;
  key countr : abap.numc(6) not null;
  status     : abap.char(2);
  statxt     : abap.char(70);
  uname      : abap.char(12);
}
