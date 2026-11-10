@EndUserText.label : 'Classification: object ↔ internal number'
define table inob {
  key mandt : abap.clnt not null;
  key cuobj : abap.char(18) not null;
  klart     : abap.char(3);
  obtab     : abap.char(20);
  objek     : abap.char(50);
}
