@EndUserText.label : 'Inspection lot'
define table qals {
  key mandt      : abap.clnt not null;
  key prueflos   : abap.char(12) not null;
  art            : abap.char(8);
  herkunft       : abap.char(20);
  matnr          : abap.char(40);
  werk           : abap.char(4);
  charg          : abap.char(10);
  losmenge       : abap.dec(13,3);
  mengeneinh     : abap.char(20);
  ebeln          : abap.char(10);
  ebelp          : abap.numc(5);
  mblnr          : abap.char(10);
  mjahr          : abap.numc(4);
  zeile          : abap.numc(4);
  aufnr          : abap.char(12);
  kdauf          : abap.char(10);
  pastrterm      : abap.dats;
  enstehdat      : abap.dats;
  objnr          : abap.char(22);
  entstezeit     : abap.tims;
  ersteller      : abap.char(20);
  lagortchrg     : abap.char(20);
  lifnr          : abap.char(10);
  paendterm      : abap.dats;
  stat35         : abap.char(20);
}
