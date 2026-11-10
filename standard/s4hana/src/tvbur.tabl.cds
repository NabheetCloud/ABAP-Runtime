@EndUserText.label : 'Sales office'
define table tvbur {
  key mandt : abap.clnt not null;
  key vkbur : abap.char(4) not null;
  adrnr     : abap.char(10);
  bezei     : abap.char(40);
}
