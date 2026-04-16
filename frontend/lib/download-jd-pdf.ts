// frontend/lib/download-jd-pdf.ts
// Generates a branded Pulse Pharma JD as a print-ready HTML page.
// Opens in a new tab. User clicks "Save as PDF" or Ctrl+P.
// Pure browser approach — no react-dom/server, no SSR, no server round-trip.

export const PULSE_LOGO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEA3ADcAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCACAAYYDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDoP+Dnn/k/fwj/ANkh0/8A9Omq1+cdfq9/wdL/AAptNP8AiX8JfjjaQXDT6toeo6FfyeUfKiS0miuIAW6BmN7c4BwSIzjODj8oa9nDO9GJ/SnBlWNbhjDOPSLXzTaf5BRRRW59QFFFFABRRRQBo+EvGHi3wD4ks/GXgTxRqOi6xp0wm0/VdJvpLa5tpB0eOWMhkYeoINfcX7C//Bfr9r39mzxBpvhf4/eJbz4oeBVn2ahDr03m61aQs0jPJb3znzJnDSBtly0qlIliRoAd6/BlFROnCorSR5+YZVl2a0XTxVJTT7rVej3T80z+sL9n34+/C79p/wCEGifHL4N+IV1Pw/r1r5tnPt2yRsGKyRSL1SRHDIy9mU9Rgnsq/DH/AINsv2vvEPw0/akvv2Q9XmvLrw98SLOe70u3VmdLDV7O3eczBWlCRJLaxTJIyo8jvDaDIVCR+51eRWp+xqcp/OfE2SS4fzaWFveNlKLe7i9r+aaafe1wooorE+fCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAPlv8A4LGfsf6x+2h+wp4k8AeDdLa88VeH7iLxH4TtVldTPeWyuHhVUB8ySW2luYo0I2mWWMkqBuH819f16V+NP/Bdf/gjz4p0PxT4g/bw/Zk0a41TSNUuJNR+I/ha1h33Gm3DfNNqkAUbpbd2zJOvLwuzS5aFn+zd2DrKPuS+R+peHfElHByeW4mVozd4N7czsnH57rzut2j8oaKKK9I/agooooAKKKKACiiigD3z/gln4g1fw1/wUX+DGo6JeNBNJ8QNPtXkXvDPKIJV+jRyOp9mr+niv5e/+CaH/KQr4K/9lN0b/wBK46/qErzMd/EXofiXiil/alB/3P8A25hRRRXEfmAUUV82/wDBXX9sP4mfsC/8E8viF+1p8HdC0LUvEfhP+yf7OsvE1rNNYyfatWs7OTzEgmhkOI7hyu2RcMFJyAVIB9JUV/Nz/wARhn/BTH/ohvwL/wDCZ1n/AOW1H/EYZ/wUx/6Ib8C//CZ1n/5bUAf0jUV/Nz/xGGf8FMf+iG/Av/wmdZ/+W1H/ABGGf8FMf+iG/Av/AMJnWf8A5bUAf0jUV/Nz/wARhn/BTH/ohvwL/wDCZ1n/AOW1egfs/f8AB5P+0PpOuTRftUfsh+C/EGm3E1uttP8AD/UrvR57GPc3nuyXj3i3bFSpRA1uAUIZyHBQA/oGor5x/wCCe3/BVn9jH/gpl4Mk8Q/s2/ERl1qzSR9Y8C+IhFa67psaOi+bLbLI4eE+ZFieF5IsyBC4kDIv0dQAUUUUAFFFFABRRRQAUUUUAFFfzc/8Rhn/AAUx/wCiG/Av/wAJnWf/AJbV+hf/AAb+f8Fpv2pf+CrPj74leFf2h/AXgDRrfwbo+nXelv4L0u+t3le4lmRxKbm8uAwAjXG0Kck5J7AH6d0UUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRXwWP8Ag48/4JvE4OoeOB7/APCK9P8AyLXoHgj/AILk/wDBLjx3q2m6DY/tSWun3uqSxxRx654d1Kyhgdu01xNbLbxAHq7SBB1LY5rT2NX+V/ce1U4b4gpRvLC1Lf4JP8kcb+3X/wAEEv2S/wBr/XL74l+ALy4+GPjbUro3Go6todmLjT9QlYxb5J7BnRd5VHO6B4C0kzyS+axr82fiz/wbtf8ABSv4e61Dp3gnwT4Z8eWs0bOdQ8NeKra3SDDEBJF1E2rbyMN8gdQDjdniv328C+PvAvxQ8K2njr4aeNdJ8RaHfq5sdZ0LUoru1uQrsjGOWJmR8OrKcE4ZSDyDWtWlPE1qen5nrZZxtxFk8PYqanGOnLNN2tpa91LTteytoj+ZTVv+CSv/ AAUl0XUZtLvP2OPGjyQuVdrSwW4jJH92SJmRh7qSKztW/wCCX3/BQrQdKutc1j9kDxzbWdnbvPdXEuiuFijRSzOT2AAJNf0+VyH7QX/JBPHH/Yoal/6SyVr9eqdkfQUvE7Np1IxdGGrS+1/mfydUUUV6Z+2BRRRQB7h/wTQ/5SFfBX/spujf+lcdf1CV/L3/AME0P+UhXwV/7Kbo3/pXHX9QleZjv4i9D8T8Uf8AkZ0P8D/9KYUUUVxH5eFfC3/Byr/yhQ+NP/cuf+pJpdfdNfC3/Byr/wAoUPjT/wBy5/6kml0AfyiV9Jfsef8ABIr/AIKG/t9fDO++MX7Jf7Pn/CWeHNN12XRr3Uf+Es0mw8u+jhhneLy7y7hkOI7iFtwUqd+ASQwHzbX9I3/Bnn/yjP8AHH/ZdNT/APTNotAH5Rf8Q1X/AAWv/wCjLf8AzI3hv/5Y0f8AENV/wWv/AOjLf/MjeG//AJY1/V3RQB/KJ/xDVf8ABa//AKMt/wDMjeG//ljXyl+0f+y9+0L+yF8Tbn4O/tMfCDXPBniO2VpBp+tWZjFzCJZIvtFvIMx3Nu0kUirPCzxOUbazYr+2ivgr/g5B/ZB8FftP/wDBLnx54zuvBWl3ni/4Y6f/AMJN4R1y8Zo5tMihmhfUljkQbistikymFsxvIkDMA0UboAfy/fAj47fFv9mT4weH/j18CvHF74b8WeF9QW80bWLB8PFIAVZWU5WSJ0Zo5InDJLG7xurIzKf7DP8Agnd+2f4T/wCCgn7G3gf9rHwnpLaaPFGmt/amjvKHOnahBK9vd2+RyyLNFJsZgpeMxuVXdgfxi1/RF/wZv/Emw1T9i74rfCCOwkW60L4oLrE10W+WSO+062hRAMcFTpzknPO8dMcgH7BUUUUAFFFFABRRRQAUUUUAfwt1+1n/AAZj/wDJY/jt/wBizon/AKUXVfinX7Wf8GY//JY/jt/2LOif+lF1QB+/FFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQB/IXRRRX0B/Xh337PH7Uv7Qv7J/jT/AIT/APZ2+LOr+FdSYAXDafMGgu1AbalxbyBobhRuJCyo6g8gAgGv3O/4JP8A/BaXwN+33M/wc+Luj6b4R+KVvG01pptnM4sfEFuqbpJLPzWZ0ljAYvbMzt5a+ajyKJRD/PnVzw94h1/wlr9j4r8Ka5eaXqml3kV3pupafcvDcWlxG4eOaKRCGjdWAZWUgqQCCCKxrUIVlrv3PmeIuF8u4gw7U4qNW3uzS1Xr/MvJ/KzP66Kw/iZ4YuvG/wAN/EHguynSKbWNDu7KGSTO1GlhZAT7AtXzj/wSF/4KA2v7f37K1r4l8TXsf/CeeE3i0nx1bs8CvcXAjBj1FYoseXFcqGYfJGoljuI0BWIMfqqvHlGUJWZ/OuMwmJyvHSoVlacHZ+q6+j3XdH8hdFevft7/ALOx/ZP/AGyfiJ+z/DYtb2Ph/wASzDQ4WvBOw0yYC4sS7/xObWaAtnkMSDyDXkNe7GXNG6P6qw9enisPCtTd4ySa9Grr8Aooopmx7h/wTQ/5SFfBX/spujf+lcdf1CV/L3/wTQ/5SFfBX/spujf+lcdf1CV5mO/iL0PxPxR/5GdD/A//AEphRRRXEfl4V8Lf8HKv/KFD40/9y5/6kml19018Lf8AByr/AMoUPjT/ANy5/wCpJpdAH8olf0jf8Gef/KM/xx/2XTU//TNotfzc1/SN/wAGef8AyjP8cf8AZdNT/wDTNotAH6vUUUUAFfO//BXH/lFz+0J/2R7xB/6QTV9EV+fP/BzB+2H4V/Zj/wCCX3i74dL4tis/F/xY2eGfDGmq0TzXNs0sbalKY2YN5C2fmxNKqsElurdTtMimgD+WGv3w/wCDMP8A5Jj8fP8AsPeH/wD0TfV+B9f0Vf8ABnN8NdP0f9h34nfFsLMt94g+KZ0uRXXCNb2WnWskbL6/PfTg/wC7jsaAPhX/AIOC/wBvP9uT4L/8Fefi58NPg7+2b8WPCfhzTf7A/s7w/wCGfiJqdhY2vmaBp0snlwQTrGm6R3dtqjLOzHJJNeN/8E4P+CjX/BQrxz/wUM+A/grxt+3f8ZtY0bWPjJ4YstW0nVPihq1xa3ttLqtsksE0UlwUkjdGZWRgVZSQQQau/wDByr/ymv8AjT/3Ln/qN6XXhn/BLf8A5SZ/s7/9ly8J/wDp4taAP7LqKKKACv5Nf+Cjf/BRv/goX4H/AOChXx48FeCv28PjNo+jaP8AGbxRZaTpOl/FDVre1srWLVrmOKCGKO4CRxoiqqooCqoAAAFf1lV/Gf8A8FQ/+UmH7RP/AGXTxd/6ebugD7M/4N9P28/25PjR/wAFefhH8NPjF+2b8WPFnhzUv7f/ALR8P+JviJqd/Y3Xl6BqMsfmQTztG+2REddynDIrDBANf0yV/KJ/wbVf8pr/AILf9zH/AOo3qlf1d0Afwt1+1n/BmP8A8lj+O3/Ys6J/6UXVfinX7Wf8GY//ACWP47f9izon/pRdUAfvxX46/wDBcH/g5W1L9lT4gaz+x5+wTDpWoeONFuJLLxl4/wBShS8tNCuBGytaWcOTHNeRSFfMeYNFC8TQtFKxfyf0+/bS+Lvin9n79jn4s/HnwNDZya34J+Geva/o8eoQtJbtdWenz3EQkVWUsheNdwDKSMgEda/ipkkkmkaWV2ZmbLMxySfU0Aep/tFfty/tj/tbXdxcftKftN+NvGcFxqUt+ul654inl0+2nkbLNb2e4W9svYJFGiKAFUAAAeVV99f8EGf+CNPh7/grP8UfGF98V/ihf+G/AXw9tbP+3ovD+watqV1erci2it3mjkhhRTbSSSSOjnASNYz5rSw/sX4L/wCDVX/gkX4W8PQ6LrngPxt4kuYs+Zq2teN547ibn+IWggiGOnyxrQB/L1XvH7KX/BTr9vn9iW6sf+GbP2pvFmgaZp7ytB4Zl1I3mjEyjEhOnXPmWpZh/H5e8HlWBANf0FeOf+DVH/gkd4t8NzaHoHgrxx4XupGQprOh+NppLmIBgSFW8W4hwwG07oycE4IOCPwx/wCCy3/BL3Wf+CVH7WzfBW08YzeJPCXiDSF1zwTr1xaNHO1k80sRtbohREbqF4irmIlXR4ZdsRl8mMA/e3/giV/wXa8Cf8FVrDUPhL488DR+D/i14b0ZdR1XSbBpJdN1ezVo4pb2zd8tCFmkQNbyszIJYyskw8wx/oHX8VP7GH7Tvi79jH9qzwD+1J4J+0Pe+CfE1tqMtna3n2dr+1DbbqzMmG2JcW7TQMcH5JW4PSv7VqAPHf25/wBun9nv/gnf+z/qH7Rn7R/iOaz0e1mW10/T9PhWW+1e+dWaOztY2ZQ8rBHPzMqKqM7sqqzD+bv9uj/g5G/4KV/th+I7i18BfFW8+D3g9bnfpvhv4b6hJZ3aqksrRvcamu26ml8uRY5BG0NvJ5SMLdGyTX/4ON/27vE37Zv/AAUn8WeDYri+t/CPwfv7rwb4Z0m4Z1UXFrO0eo3pjE0kXmT3aOolQRtJbW9mJEDxmvkT9mP9nL4p/tdfH7wp+zX8FdF+3eJvGGrx2Gmxur+VDkFpLiYorMkEMSvNK4U7I43bB20Acfr2v674p1q68R+J9au9S1C+maa9v7+4aaa4kY5Z3dyWZieSSSTVSv6UP2Tf+DSj/gnz8J/DVrdftR+I/FHxY8RyWLx6ojapJo2kJKZSyyW8Fmy3KlY9sZMlzIrkM+xNyonsX/EM5/wRa/6NFuP/AA4mv/8AydQB/Ld8L/i58Vvgh4vh+IXwX+JviHwhr9tG8dvrnhfWp9PvIlcbXVZoHV1DDggHkda/Tz/gmd/wdQftT/s36tY/Dj9ulr/4teAo7ZLZNaVIl8S6WEEaq4nYouojar71uSJneQObkBSj/UP/AAUW/wCDSX4Jal8NvEPxN/4JzeKtf0nxhZo15pvw58Sasl1peooiLmytbmVRPbTNhmR7iWZGkKozQoxlj/AGgD+374N/GP4ZftB/CvQPjb8GfGFrr/hbxRpkWoaHq9nuCXEEgyDtcB42HKtG6q6MrK6qykAr8Tf+DPz9uTxvfa34/wD+Cf8A431q+vtB07Qm8YeCzdXAMOjhbqG3v7ZNx3Kk0l3bTLGuEV0uHxumYkoA/OOiiivoD+vAooooA+8P+Ddv9oTXPhJ/wUI0/wCFov2XRfiTot5pWpW82otDbpcQQveWtwY/uyzBoHt0zyBeSBTliG/oEr+Wr/gnuzL+3x8ECpx/xd7w0P8AyqW9f1K15eNjaon3R+GeJ2Fp0s4pVo7zhr6xbV/usvkfm3/wcI/8E3te/aR+Gtn+178HdNW58V/D/R5LfxJpqtIZdU0RXaYNCuSnm2zvPJtCq0kc0vzs0UUbfhfX9elflT/wVA/4N7NN+Id5efHL9gTTLLTNcuruSfWvh1cXSW1jd78sZLCR8JbPv6wOVhKudjQiMRyVhcQorkn8jt4H4yoYOisux8rRXwSeyv8AZk+ivs9ls7JI/GGitr4g/Dj4hfCXxbdeAvin4F1jw3rljsN5o+vabLZ3UAdA6FopVVlDIysCRyrAjIINYtekfskZRnFSi7p7M9w/4Jof8pCvgr/2U3Rv/SuOv6hK/l7/AOCaH/KQr4K/9lN0b/0rjr+oSvMx38Reh+K+KP8AyM6H+B/+lMKKKK4j8vCvhb/g5V/5QofGn/uXP/Uk0uvumvhb/g5V/wCUKHxp/wC5c/8AUk0ugD+USvpL9jz/AIK6/wDBQ39gX4Z33wd/ZL/aD/4RPw5qWuy6ze6d/wAInpN/5l9JDDA8vmXlpNIMx28K7QwUbMgAlifm2vsH/gn5/wAEP/22v+Clnwa1P46/s2nwf/Yek+JptBuv+Eg157Wb7XFb29w2EET5TZdRYbPXcMccgHUf8RKv/Ba//o9L/wAxz4b/APldR/xEq/8ABa//AKPS/wDMc+G//ldXpn/EJl/wVc9fhn/4WMn/AMjUf8QmX/BVz1+Gf/hYyf8AyNQB5n/xEq/8Fr/+j0v/ADHPhv8A+V1fJ/7Q/wC0x8f/ANrP4mXXxh/aT+LuueM/El3vU6lrl80v2eJppJvs8CfctrdZJZGS3iVIo95CIo4r9AbH/g0q/wCCq13dJb3Go/C21Vmw08/jCcqnudlqzfkDXsHwA/4M2/2ktV8Us37U37WvgfQdEhaF41+H9neatdXq7/3sRN3FZpbHZ92XE+GPMZA5APyd/Zt/Z3+LH7WXxz8M/s7fBDwzNq3ibxXqkdjpttHG7JHuOXnlKKxjgiQNLJJjEccbueFNf2IfsHfsieDv2Df2QvAf7JPgbVpNRs/BujfZ7jVJImjOoXksr3F3deW0khiEtzNNKIt7CMOEBIUGuZ/4J/8A/BMH9j3/AIJpfD6bwR+zH8OjBfahg694u1qRbrWdXYBQPPudq4jG0EQRLHCrFmWMM7s30FQB/KJ/wcq/8pr/AI0/9y5/6jel14Z/wS3/AOUmf7O//ZcvCf8A6eLWvc/+DlX/AJTX/Gn/ALlz/wBRvS68M/4Jb/8AKTP9nf8A7Ll4T/8ATxa0Af2XUUUUAFfxn/8ABUP/AJSYftE/9l08Xf8Ap5u6/swr+M//AIKh/wDKTD9on/suni7/ANPN3QB7r/wbVf8AKa/4Lf8Acx/+o3qlf1d1/KJ/wbVf8pr/AILf9zH/AOo3qlf1d0Afwt1+1n/BmP8A8lj+O3/Ys6J/6UXVfinX7Wf8GY//ACWP47f9izon/pRdUAftZ+2p8I/FX7QH7HHxa+A/gWS0TXPG3wz17QNHfUJjHAt1eadPbxGRgrFU3yLuIUkDJwelfxWX1je6ZezabqVnLb3FvK0VxbzxlHidThlZTyCCCCDyDX9z9fk3/wAFlv8Ag2b8J/tu/EbUv2p/2MvFeh+BfiDq+6fxX4Z1a2ePR/El40ilr4SQhmsrpkMplKxSJcybHYRSNPPKAfl//wAEFf8Agsz4R/4JMfEfxppvxc+FWqeJPBPxChsjrN14dkiOqaZPZJdmCSCKZ44rhHa5KSI8kZUbXViUMcn7X/Cf/g5g/wCCOnxR07RX1D9pi88JaprUkUR0PxZ4N1KGSwkkYKFubiGCWzjAJG6TzzGoyS4AJH89Pxk/4Iz/APBVP4D+IH8OePf2C/iTPLHZi6ku/C/h2TXrNIjnlrrTPtECsACSpfco5IGRXzVeWd5p15Np+oWklvcW8jRzwTRlXjdTgqwPIIPBB5BoA/tY+D37ZX7IP7Q3iObwf8Af2qvhv441e3s2u7jSvB/jjT9TuYrcMqmZoreZ2VAzopYjALKM5Iq38aP2Vf2X/wBpC40+7/aI/Zv8BePZdJSRNKk8aeD7LVGslkKmQRG5ifywxRNwXGdq5zgV/ExXr37Pv7f37b37KkWn2H7Ov7WHj/wjpul6supW2g6R4ouU0t7kMpLy2Jc204bYodJY3V1G1wy8UAf1pf8ADrz/AIJn/wDSO34F/wDho9G/+Rq90r8OP+CQn/B1D4g8bePtH/Zy/wCCnV3otrHqr/ZdK+MVrbx2MMV0z/u01aCMLBDE+4p9riEUcO2PzYwhluI/3HoA/hj1bV9V1/VbrXdd1O4vb69uHnvLy7maSWeV2LPI7sSWZmJJYkkk5NfpV/wax/Fz9mr4B/t4+MPi3+0v8ZPBfguxtPhddWWh3/jTWLWxja8nv7EkwS3DqBKIY5lIU7ikjjpkH8zaKAP7Jf8Ah65/wTD/AOkhnwV/8Obpf/x+j/h65/wTD/6SGfBX/wAObpf/AMfr+NqigD+yX/h65/wTD/6SGfBX/wAObpf/AMfr+Uf/AIKV694O8Wf8FD/jp4x+HnizT9e0LWvi34h1LSNY0m6Se1vLe41GeZJIpEJV0KuMMpII5FeJUUAS2l7eWEhmsrqSFiuC0bFSR6cUVFRQB9YUUUV9Af14FFFFAHr3/BPn/k/f4If9le8Nf+nS2r+pav5af+CfP/J+/wAEP+yveGv/AE6W1f1LV5uO+JH4r4pf7/h/8L/MKKKK4T8tCiiigAooooAKKKKACvjP/AIOC/hd8TPjR/wAEhvi58NPg78Otd8WeI9S/sD+zvD/hnSJr++uvL1/TpZPLggVpH2xo7ttU4VGY4AJr7MooA/jP/wCHXn/BTH/pHb8dP/DR6z/8jV+/3/Bqp8Bvjl+zx/wT18ZeCvj/APBjxZ4F1m6+M2oXtrpPjHw7c6ZdTWraTpEazrFcojtGXjkUOBtLRsM5U4/TKigAooooAKKKKACiiigDzX9r/wDZN+Df7cX7Onib9mD49aRcXXhvxRZiG4ksbgQ3VnMjiSG6t5CGCTRSqki7lZCV2ujozI38zH7f3/Bur/wUW/Yh8SzXfhP4Yah8XPBUkzf2f4u+HekTXkyR5mIF5p8Ye4tHEUQkdgJLZPNRBcOxIH9WNFAH8LdWNL0vU9c1O30TRNOuLy8vLhILS0tYWklnldgqoiqCWZiQAoBJJwK/ucooA/me/wCCWn/BsZ+1j+1n4ltviJ+2d4b1z4P/AA5t2SVrPV7EQeINc2zvHJbxWcv7ywAET5nuo1OJIWiinR2ZMT/guP8A8Ezf2s7/AP4Kc/EC3/ZZ/YU+KWsfDzTNH8L6V4RvPCfw81XUNOFnZ+G9MtFhhuIoXWQRGExH5mIaNgTuBr+nyigD+Zv/AIN9P2Df25Pgv/wV5+EfxL+MX7GPxY8J+HNN/t/+0fEHib4danYWNr5mgajFH5k88CxpukdEXcwyzqoySBX9MlFFAH8Wv/DA/wC3V/0ZZ8Wv/Dc6n/8AGK/YL/g0X/Z5+P8A8Efi18a734z/AAN8YeEYdQ8O6OlhN4o8M3Wnrcss9yWWMzxqHIBBIGcZGetfuRRQAV+SX/BbT/g2t0P9srxfrn7Xn7Emo6Z4Z+JF9azXfibwTdRCHTvFt8CG+0RTbgtjeyL5gdmUw3EpjeQwOZ7iX9baKAP4u/2mv+Cfv7bP7G95dQftN/sveMvCNrZ3wsm1vUNFkbS5pyu4JDfxBrW4JH/PKVxwR1Bx4/X90lFAH8Ldeofs8/sUfteftZXUcH7NX7NHjfxtC2qRadNqXh7w3cXFjaXEhUKtxdKnkWw+YMzyuiovzMVUE1/apRQB+JH/AAR5/wCDWvXvhT8QvDX7VH/BRrVNPl1LQb7+0NG+EelypdQx3cZja2n1K8jcxzCOQSMbSEPE5WEvO6GW3b9t6KKAPnf/AIKT/wDBMz9nD/gqF8Cl+Dfx6064tL7Tbhrvwn4v0kIuo6FdEAM0TMCHikVQksDgpIoU/LJHFLH/ADs/tz/8G43/AAUt/Y48UTP4L+EOofF/wjNfGHSPE3wz02a/uXVnm8oXOmxhrq2k8qJXkKrLbxtKkYuJGPP9V1FAH8M2v6BrvhXXLzwz4o0W703UtPuXt9Q0/ULZoZ7aZGKvHJG4DI6sCCpAIIwaqV/dJRQB/D/8Kvg38X/jt4sXwF8EPhV4k8Za7JA8yaL4V0O41G7aNcbnENujuVGRk4wMjNfpN/wTo/4NZf20P2lvEGmeNv2xrO4+D3gFltbue1vGil8Q6pbuQ7QQ2oLfYJNgKs14FeF3Q/Z5sOo/paooA5P4FfAr4R/szfCLQfgN8B/Adj4Z8I+GbEWmi6Lp6ny4I9xZmLMS0kjuzySSuzSSSO7uzOzMSusooA8V/b9/Yg+G/wDwUB/Z01D4DfELUbnTZluV1Hw3rlnln0rU445EiuDHkLMm2SSN4mI3RyPtaN9kifzYftI/s2/GD9k34u6p8Evjf4Tm0nXNLk/iUmG8hJIS5gcgCWF8Eq49CCAyso/q5rxn9tP9gr9m/wDb4+Htv4A/aB8JzTPp0zy6H4g0uYW+paTI67XMExVhtYAbonV4nKIzIWjQr1YfEOjo9j7jhDjCpw/UdCunKhJ3st4vuu6fVfNa3v8Ay40V9+ftY/8ABuz+258Cr261n4HJY/Fbw3Dbyz/adGZLLVIo44Ud/MsZpCXdmMixpbSXDyeWCVRnVK+L/il8Bfjn8Dbm0s/jZ8F/Fng+a/jZ7GLxT4dutPa5VSAzRidELgEgEjOM16calOfws/csBnOV5pBSwtaM79E9fnF6r5pHZf8ABPn/AJP3+CH/AGV7w1/6dLav6lq/lp/4J8/8n7/BD/sr3hr/ANOltX9S1cGO+JH5P4pf7/h/8L/MKKKK4T8tCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP//Z";

function getField(data: any, ...keys: string[]): string {
  const emp = data?.employee_information || {};
  for (const k of keys) {
    let v = data?.[k] || emp?.[k];
    if (!v && data?.qualifications?.[k]) v = data.qualifications[k];
    if (v && typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function getArray(data: any, ...keys: string[]): string[] {
  for (const k of keys) {
    let v = data?.[k];
    if (!v && data?.qualifications?.[k]) v = data.qualifications[k];
    if (Array.isArray(v) && v.length > 0) return v.filter(Boolean);
    if (typeof v === "string" && v.trim()) {
      return v.split("\n").map(s => s.replace(/^[-\*\u2022]\s*/, "").trim()).filter(Boolean);
    }
  }
  return [];
}

function getStakeholder(data: any, type: "internal" | "external"): string {
  const s = data?.stakeholder_interactions || data?.stakeholders || data?.working_relationships || {};
  const v = type === "internal"
    ? (s?.internal || s?.internal_stakeholders || "")
    : (s?.external || s?.external_stakeholders || "");
  return Array.isArray(v) ? v.join(", ") : (v || "");
}

function esc(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function listHtml(items: string[]): string {
  if (!items.length) return "To be confirmed with line manager.";
  return "<ul style=\"margin:0;padding-left:20px\">" +
    items.map(i => `<li style="margin-bottom:3px">${esc(i)}</li>`).join("") +
    "</ul>";
}

export function downloadJDPdfClient(data: any, roleTitle?: string, dept?: string): void {
  if (!data) { alert("No JD data available to download."); return; }

  const designation  = esc(getField(data, "job_title", "title", "designation") || roleTitle || "—");
  const band         = esc(getField(data, "band"));
  const grade        = esc(getField(data, "grade"));
  const func         = esc(getField(data, "department", "function") || dept || "—");
  const location     = esc(getField(data, "location"));
  const reportingTo  = esc(
    getField(data, "reports_to", "reporting_to") ||
    data?.working_relationships?.reporting_to ||
    data?.team_structure?.reports_to || "—"
  );
  const teamSize     = esc(String(
    data?.team_structure?.team_size ||
    data?.working_relationships?.team_size || "—"
  ));
  const internal     = esc(getStakeholder(data, "internal") || "—");
  const external     = esc(getStakeholder(data, "external") || "Not applicable");
  const purpose      = esc(getField(data, "purpose", "role_summary"));
  const responsibilities = getArray(data, "responsibilities", "key_responsibilities");
  const skills       = getArray(data, "skills", "required_skills");
  const tools        = getArray(data, "tools", "tools_and_technologies");
  const allSkills    = [...skills, ...tools.map((t: string) => `${t} (Tool/Platform)`)];
  const education    = esc(getField(data, "education"));
  const experience   = esc(getField(data, "experience"));
  const eduExp       = [education, experience].filter(Boolean).join("<br/><br/>");
  const safeTitle    = esc(roleTitle || "Job Description");

  const H = "#BFBFBF"; // section header background — matches company template exactly

  const sectionHeader = (text: string) =>
    `<tr><td colspan="2" style="background:${H};font-weight:bold;text-align:center;
     padding:8px 10px;font-size:12pt;border:1px solid #999;">${text}</td></tr>`;

  const subHeader = (text: string) =>
    `<tr><td colspan="2" style="background:${H};font-weight:bold;text-align:center;
     padding:6px 10px;font-size:11pt;border:1px solid #999;">${text}</td></tr>`;

  const labelRow = (label: string, value: string, extraStyle = "") =>
    `<tr>
      <td style="font-weight:bold;padding:7px 10px;width:35%;border:1px solid #999;
                 vertical-align:top;font-size:11pt;${extraStyle}">${label}</td>
      <td style="padding:7px 10px;border:1px solid #999;vertical-align:top;
                 font-size:11pt;white-space:pre-wrap;${extraStyle}">${value}</td>
    </tr>`;

  const TABLE = `style="width:100%;border-collapse:collapse;margin-bottom:14px;page-break-inside:avoid;"`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${safeTitle} — Pulse Pharma</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000;background:#fff;
         -webkit-print-color-adjust:exact;print-color-adjust:exact}
    @page{size:A4;margin:15mm}
    @media print{.topbar{display:none!important}.content{margin-top:0!important}}
    .topbar{position:fixed;top:0;left:0;right:0;background:#1F4E79;color:#fff;
            padding:10px 20px;display:flex;align-items:center;
            justify-content:space-between;z-index:100;font-family:Arial,sans-serif;font-size:13px}
    .topbar button{background:#fff;color:#1F4E79;border:none;padding:7px 18px;
                   border-radius:5px;font-weight:bold;font-size:13px;cursor:pointer}
    .topbar button:hover{background:#dce8f4}
    .content{margin-top:52px;padding:20px 30px;max-width:860px;margin-left:auto;margin-right:auto}
  </style>
</head>
<body>
<div class="topbar">
  <span>📄 Pulse Pharma &mdash; ${safeTitle}</span>
  <button onclick="window.print()">⬇&nbsp; Save as PDF / Print</button>
</div>
<div class="content">

  <!-- Logo -->
  <div style="text-align:center;margin-bottom:18px">
    <img src="${PULSE_LOGO}" alt="Pulse Pharma" style="height:75px;object-fit:contain"/>
  </div>

  <!-- Table 1: Job / Role Information -->
  <table ${TABLE}>
    <tbody>
      ${sectionHeader("Job / Role Information")}
      ${labelRow("Designation", designation)}
      ${labelRow("Band &amp; Band Name", band)}
      ${labelRow("Grade", grade)}
      ${labelRow("Function", func)}
      ${labelRow("Location", location)}
      ${subHeader("Job Description")}
      <tr>
        <td colspan="2" style="padding:10px;border:1px solid #999;font-size:11pt">
          ${purpose ? `<div style="font-weight:bold;margin-bottom:6px">Purpose of the Job / Role :</div>
          <div style="margin-bottom:14px;padding-left:4px">${purpose}</div>` : ""}
          ${responsibilities.length ? `<div style="font-weight:bold;margin-bottom:8px">Job Responsibilities</div>
          <ul style="margin:0;padding-left:22px">
            ${responsibilities.map((r: string) => `<li style="margin-bottom:5px">${esc(r)}</li>`).join("")}
          </ul>` : ""}
        </td>
      </tr>
    </tbody>
  </table>

  <!-- Table 2: Working Relationships -->
  <table ${TABLE}>
    <tbody>
      ${sectionHeader("Working Relationships")}
      ${labelRow("Reporting to", reportingTo)}
      ${labelRow("Team", teamSize)}
      ${labelRow("Internal Stakeholders", internal)}
      ${labelRow("External Stakeholders", external)}
    </tbody>
  </table>

  <!-- Table 3: Skills / Competencies -->
  <table ${TABLE}>
    <tbody>
      ${sectionHeader("Skills/ Competencies Required")}
      <tr>
        <td style="font-weight:bold;padding:7px 10px;width:35%;border:1px solid #999;
                   vertical-align:top;font-size:11pt">Skills</td>
        <td style="padding:7px 10px;border:1px solid #999;vertical-align:top;font-size:11pt">
          ${listHtml(allSkills)}
        </td>
      </tr>
    </tbody>
  </table>

  <!-- Table 4: Academic Qualifications & Experience -->
  <table ${TABLE}>
    <tbody>
      ${sectionHeader("Academic Qualifications &amp; Experience Required")}
      <tr>
        <td style="font-weight:bold;padding:7px 10px;width:35%;border:1px solid #999;
                   vertical-align:top;font-size:11pt">
          Required Educational Qualification &amp;<br/>Relevant experience
        </td>
        <td style="padding:7px 10px;border:1px solid #999;vertical-align:top;font-size:11pt">
          ${eduExp || "To be confirmed with line manager."}
        </td>
      </tr>
    </tbody>
  </table>

  <!-- Footer -->
  <p style="font-size:9pt;color:#333;margin-top:16px;line-height:1.5">
    Pulse Pharma is an equal opportunity employer - we never differentiate candidates on the
    basis of religion, caste, gender, language, disabilities or ethnic group. Pulse reserves
    the right to place/move any candidate to any company location, partner location or
    customer location globally, in the best interest of Pulse business.
  </p>
</div>
</body>
</html>`;

  const win = window.open("", "_blank", "width=920,height=720");
  if (!win) { alert("Please allow pop-ups to download the PDF."); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}