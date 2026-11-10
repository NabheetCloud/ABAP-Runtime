@EndUserText.label : 'Set header'
define table setheader {
  key mandt    : abap.clnt not null;
  key setclass : abap.char(4) not null;
  key subclass : abap.char(12) not null;
  key setname  : abap.char(24) not null;
  valfrom      : abap.char(24);
  valto        : abap.char(24);
  descript     : abap.char(40);
  settype      : abap.char(20);
}
