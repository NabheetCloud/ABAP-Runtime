@EndUserText.label : 'Storage locations'
define table t001l {
  key mandt : abap.clnt not null;
  key werks : abap.char(4) not null;
  key lgort : abap.char(4) not null;
  lgobe     : abap.char(16);
  vkorg     : abap.char(4);
  vtweg     : abap.char(2);
}
