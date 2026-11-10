@EndUserText.label : 'IDoc data records'
define table edid4 {
  key mandt   : abap.clnt not null;
  key docnum  : abap.char(16) not null;
  key counter : abap.numc(6) not null;
  key segnum  : abap.char(6) not null;
  segnam      : abap.char(30);
  sdata       : abap.char(1000);
}
